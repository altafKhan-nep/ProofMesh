use anchor_lang::prelude::*;

declare_id!("6hrtRLHSL3aKQifdz1prM1APBCRAz2XjghqxfNxBkJeV");

/// The only address permitted to create or update a credential.
///
/// Previously `MintCredential.authority` was an unconstrained `Signer`, so ANY
/// account with SOL could mint an Expert credential for ANY wallet and become
/// its `authority` — collapsing the whole trust model to "whoever paid the
/// rent". ARCHITECTURE.md §9 specifies `authority key != signer key`; this
/// constant is the authority and it must equal the signer.
///
/// Rotation path: replace this constant with an `Issuer` PDA (seeds = [b"issuer"])
/// seeded by a governance authority, and add an `initialize_issuer` instruction.
pub const ISSUER: Pubkey = pubkey!("6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ");

pub const CREDENTIAL_SEED: &[u8] = b"credential";
pub const CREDENTIAL_DISCRIMINATOR: usize = 8;
pub const SCHEMA_LEN: usize = 32;
pub const ANALYZER_LEN: usize = 16;

/// Default credential lifetime when the caller passes `expires_at = 0`.
pub const DEFAULT_TTL_SECONDS: i64 = 180 * 86400;
/// Hard ceiling. `expires_at = i64::MAX` previously minted successfully and
/// then made the verifier SDK throw `RangeError` on every read.
pub const MAX_TTL_SECONDS: i64 = 365 * 86400;
/// Issuance honesty floor — mirrors `ISSUANCE_GATE.minConfidence` in TS.
pub const MIN_CONFIDENCE_PCT: u8 = 60;

// Fixed binary layout (after the 8-byte Anchor discriminator) — this is the
// ABI the verifier-sdk parses at exact offsets. Keep in sync with
// packages/verifier-sdk/src/layout.ts.
//
//   offset  size  field
//   0       32    authority       (issuer pubkey)
//   32      32    wallet          (subject pubkey)
//   64      32    schema          (skill id, e.g. b"solana-anchor\0…")
//   96      1     skill_score     (0..=100, confidence-shrunk)
//   97      1     confidence_pct  (0..=100)
//   98      1     level           (1=Verified 2=Strong 3=Expert)
//   99      1     issuer_tier     (1=automated)
//   100     32    evidence_root   (sha256 of the evidence set)
//   132     16    analyzer_version(e.g. b"pow.solana-anchor.v1")
//   148     1     status          (0=ISSUED 1=EXPIRED 2=REVOKED)
//   149     8     issued_at       (i64 unix secs)
//   157     8     expires_at      (i64 unix secs)
//   total: 165 bytes + 8 discriminator = 173

#[account]
#[derive(Default)]
#[repr(C)]
pub struct Credential {
    pub authority: Pubkey,
    pub wallet: Pubkey,
    /// The skill id, not the ARCHITECTURE §7.2 `pow.*` schema string. The PDA
    /// is derived from the skill id and the SDK recovers the skill from these
    /// bytes, so the on-chain record stays self-describing.
    pub schema: [u8; SCHEMA_LEN],
    pub skill_score: u8,
    pub confidence_pct: u8,
    pub level: u8,
    pub issuer_tier: u8,
    pub evidence_root: [u8; 32],
    pub analyzer_version: [u8; ANALYZER_LEN],
    pub status: u8, // 0=ISSUED 1=EXPIRED 2=REVOKED
    pub issued_at: i64,
    pub expires_at: i64,
}

impl Credential {
    pub const LEN: usize = 32 + 32 + SCHEMA_LEN + 1 + 1 + 1 + 1 + 32 + ANALYZER_LEN + 1 + 8 + 8;
}

/// Layout drift guard: the verifier SDK hard-codes `TOTAL_ACCOUNT_LEN = 173` and
/// exact field offsets. If a future edit grows the struct, an un-migrated PDA
/// would silently deserialize garbage, so fail the build instead.
const _: () = assert!(Credential::LEN == 165);

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MintCredentialArgs {
    pub skill: String,
    pub skill_score: u8,
    pub confidence_pct: u8,
    pub level: u8,
    pub evidence_root: [u8; 32],
    pub analyzer_version: String,
    /// 0 selects `DEFAULT_TTL_SECONDS`; otherwise bounded by `MAX_TTL_SECONDS`.
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateCredentialArgs {
    pub skill: String,
    pub skill_score: u8,
    pub confidence_pct: u8,
    pub level: u8,
    pub evidence_root: [u8; 32],
    pub analyzer_version: String,
    /// 0 keeps the current expiry.
    pub expires_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ExtendExpiryArgs {
    pub skill: String,
    /// 0 selects `DEFAULT_TTL_SECONDS`; otherwise bounded by `MAX_TTL_SECONDS`.
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(args: MintCredentialArgs)]
pub struct MintCredential<'info> {
    /// Constrained to `ISSUER`: only the ProofMesh issuer may create records.
    #[account(mut, address = ISSUER @ ErrorCode::UnauthorizedIssuer)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = CREDENTIAL_DISCRIMINATOR + Credential::LEN,
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), args.skill.as_bytes()],
        bump
    )]
    pub credential: Account<'info, Credential>,
    /// CHECK: only used to derive the credential PDA and stored as the subject.
    /// Deliberately unchecked: `SystemAccount` requires System-program
    /// ownership, which is false for any wallet that has ever held allocated
    /// data (SPL memo extensions, tokenized accounts, `SystemProgram::allocate`),
    /// so those developers could never be credentialed at all.
    pub wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: UpdateCredentialArgs)]
pub struct UpdateCredential<'info> {
    #[account(
        mut,
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), args.skill.as_bytes()],
        bump,
        has_one = authority @ ErrorCode::UnauthorizedRevoke,
    )]
    pub credential: Account<'info, Credential>,
    #[account(mut, address = ISSUER @ ErrorCode::UnauthorizedIssuer)]
    pub authority: Signer<'info>,
    /// CHECK: seed derivation only; cross-checked against the stored subject.
    pub wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(args: ExtendExpiryArgs)]
pub struct ExtendExpiry<'info> {
    #[account(
        mut,
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), args.skill.as_bytes()],
        bump,
        has_one = authority @ ErrorCode::UnauthorizedRevoke,
    )]
    pub credential: Account<'info, Credential>,
    #[account(mut, address = ISSUER @ ErrorCode::UnauthorizedIssuer)]
    pub authority: Signer<'info>,
    /// CHECK: seed derivation only; cross-checked against the stored subject.
    pub wallet: UncheckedAccount<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GateArgs {
    pub skill: String,
    pub min_score: u8,
    pub min_confidence_pct: u8,
    pub issuer_allowlist: Vec<Pubkey>,
}

#[derive(Accounts)]
#[instruction(args: GateArgs)]
pub struct ClaimVerified<'info> {
    #[account(
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), args.skill.as_bytes()],
        bump,
    )]
    pub credential: Account<'info, Credential>,
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(revoke_skill: String)]
pub struct RevokeCredential<'info> {
    #[account(
        mut,
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), revoke_skill.as_bytes()],
        bump,
        has_one = authority @ ErrorCode::UnauthorizedRevoke,
    )]
    pub credential: Account<'info, Credential>,
    #[account(mut, address = ISSUER @ ErrorCode::UnauthorizedIssuer)]
    pub authority: Signer<'info>,
    /// CHECK: seed derivation only; cross-checked against the stored subject.
    pub wallet: UncheckedAccount<'info>,
}

/// Emitted on every state transition so revocation is attributable off-chain
/// without growing the account (the layout is frozen at 165 bytes, so the
/// account cannot carry `revoked_at`/`revoked_by`).
#[event]
pub struct CredentialEvent {
    #[index]
    pub wallet: Pubkey,
    pub skill: String,
    pub action: String,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[program]
pub mod proofmesh_gate {
    use super::*;

    pub fn mint_credential(ctx: Context<MintCredential>, args: MintCredentialArgs) -> Result<()> {
        require!(
            args.skill_score <= 100 && args.confidence_pct <= 100,
            ErrorCode::InvalidScore
        );
        require!(args.level >= 1 && args.level <= 3, ErrorCode::InvalidLevel);
        require!(
            args.confidence_pct >= MIN_CONFIDENCE_PCT,
            ErrorCode::LowConfidence
        );
        require!(is_known_skill(&args.skill), ErrorCode::UnknownSkill);

        let now = Clock::get()?.unix_timestamp;
        let expires_at = resolve_expiry(args.expires_at, now)?;

        let credential = &mut ctx.accounts.credential;
        credential.authority = ctx.accounts.authority.key();
        credential.wallet = ctx.accounts.wallet.key();
        credential.schema = pack_fixed::<SCHEMA_LEN>(&args.skill);
        credential.skill_score = args.skill_score;
        credential.confidence_pct = args.confidence_pct;
        credential.level = args.level;
        credential.issuer_tier = 1;
        credential.evidence_root = args.evidence_root;
        credential.analyzer_version = pack_fixed::<ANALYZER_LEN>(&args.analyzer_version);
        credential.status = 0; // ISSUED
        credential.issued_at = now;
        credential.expires_at = expires_at;

        emit!(CredentialEvent {
            wallet: ctx.accounts.wallet.key(),
            skill: args.skill.clone(),
            action: "mint".to_string(),
            authority: ctx.accounts.authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    /// Re-score an existing credential in place.
    ///
    /// `mint` uses `init`, so a PDA can only ever be created once: before this
    /// instruction the first mint was permanent, meaning (a) on-chain data
    /// diverged forever from every later re-score and (b) an attacker who
    /// front-ran a victim's PDA with garbage could brick that (wallet, skill)
    /// pair permanently.
    pub fn update_credential(ctx: Context<UpdateCredential>, args: UpdateCredentialArgs) -> Result<()> {
        require!(
            args.skill_score <= 100 && args.confidence_pct <= 100,
            ErrorCode::InvalidScore
        );
        require!(args.level >= 1 && args.level <= 3, ErrorCode::InvalidLevel);
        require!(
            args.confidence_pct >= MIN_CONFIDENCE_PCT,
            ErrorCode::LowConfidence
        );
        require!(is_known_skill(&args.skill), ErrorCode::UnknownSkill);

        let now = Clock::get()?.unix_timestamp;
        let credential = &mut ctx.accounts.credential;

        // Explicit identity cross-check. It held only implicitly via init+seeds
        // at mint time; a layout change could have broken it silently.
        require_keys_eq!(
            credential.wallet,
            ctx.accounts.wallet.key(),
            ErrorCode::WalletMismatch
        );
        require!(
            credential.schema == pack_fixed::<SCHEMA_LEN>(&args.skill),
            ErrorCode::SkillMismatch
        );
        require!(
            credential.status == 0,
            ErrorCode::CredentialClosed
        );

        if args.expires_at > 0 {
            credential.expires_at = resolve_expiry(args.expires_at, now)?;
        }
        credential.skill_score = args.skill_score;
        credential.confidence_pct = args.confidence_pct;
        credential.level = args.level;
        credential.evidence_root = args.evidence_root;
        credential.analyzer_version = pack_fixed::<ANALYZER_LEN>(&args.analyzer_version);
        credential.issued_at = now;

        emit!(CredentialEvent {
            wallet: ctx.accounts.wallet.key(),
            skill: args.skill.clone(),
            action: "update".to_string(),
            authority: ctx.accounts.authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    /// Extend a credential's lifetime (issuer only, ISSUED credentials only).
    pub fn extend_expiry(ctx: Context<ExtendExpiry>, args: ExtendExpiryArgs) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let credential = &mut ctx.accounts.credential;
        require_keys_eq!(
            credential.wallet,
            ctx.accounts.wallet.key(),
            ErrorCode::WalletMismatch
        );
        require!(credential.status == 0, ErrorCode::CredentialClosed);
        credential.expires_at = resolve_expiry(args.expires_at, now)?;

        emit!(CredentialEvent {
            wallet: ctx.accounts.wallet.key(),
            skill: args.skill.clone(),
            action: "extend_expiry".to_string(),
            authority: ctx.accounts.authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn revoke_credential(ctx: Context<RevokeCredential>, revoke_skill: String) -> Result<()> {
        require!(
            ctx.accounts.credential.status == 0,
            ErrorCode::AlreadyRevoked
        );
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(
            ctx.accounts.credential.wallet,
            ctx.accounts.wallet.key(),
            ErrorCode::WalletMismatch
        );
        ctx.accounts.credential.status = 2; // REVOKED

        emit!(CredentialEvent {
            wallet: ctx.accounts.wallet.key(),
            skill: revoke_skill,
            action: "revoke".to_string(),
            authority: ctx.accounts.authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn claim_verified(ctx: Context<ClaimVerified>, args: GateArgs) -> Result<()> {
        let c = &ctx.accounts.credential;
        let now = Clock::get()?.unix_timestamp;

        require!(c.status == 0, ErrorCode::CredentialClosed);
        require!(now < c.expires_at, ErrorCode::CredentialExpired);
        // Identity cross-checks: previously implicit via PDA seeds alone.
        require_keys_eq!(
            c.wallet,
            ctx.accounts.wallet.key(),
            ErrorCode::WalletMismatch
        );
        require!(
            c.schema == pack_fixed::<SCHEMA_LEN>(&args.skill),
            ErrorCode::SkillMismatch
        );
        require!(
            c.skill_score >= args.min_score && args.min_score <= 100,
            ErrorCode::BelowMinScore
        );
        require!(
            args.min_confidence_pct <= 100,
            ErrorCode::InvalidScore
        );
        require!(
            c.confidence_pct >= args.min_confidence_pct,
            ErrorCode::BelowMinConfidence
        );
        // An empty allowlist previously meant "trust any issuer". Require an
        // explicit non-empty list so an unset config cannot silently widen trust.
        require!(
            !args.issuer_allowlist.is_empty(),
            ErrorCode::EmptyIssuerAllowlist
        );
        require!(
            args.issuer_allowlist.contains(&c.authority),
            ErrorCode::IssuerNotAllowlisted
        );
        // Only the ProofMesh issuer may back a credential in the first place.
        require_keys_eq!(c.authority, ISSUER, ErrorCode::UnauthorizedIssuer);
        Ok(())
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Score must be 0..=100")]
    InvalidScore,
    #[msg("Level must be 1..=3")]
    InvalidLevel,
    #[msg("Confidence below 60 — never mint below the honesty floor")]
    LowConfidence,
    #[msg("Unknown skill schema")]
    UnknownSkill,
    #[msg("Only the credential authority may revoke")]
    UnauthorizedRevoke,
    #[msg("Credential is expired or revoked")]
    CredentialClosed,
    #[msg("Credential has expired")]
    CredentialExpired,
    #[msg("Score below the bounty minimum")]
    BelowMinScore,
    #[msg("Confidence below the bounty minimum")]
    BelowMinConfidence,
    #[msg("Issuer not in the bounty allowlist")]
    IssuerNotAllowlisted,
    #[msg("Signer is not the ProofMesh issuer")]
    UnauthorizedIssuer,
    #[msg("Credential subject does not match the supplied wallet")]
    WalletMismatch,
    #[msg("Credential was issued for a different skill")]
    SkillMismatch,
    #[msg("Credential is already revoked")]
    AlreadyRevoked,
    #[msg("Expiry must be in the future and within the 365-day ceiling")]
    InvalidExpiry,
    #[msg("Issuer allowlist must not be empty — refusing to trust every issuer")]
    EmptyIssuerAllowlist,
}

/// Single source of truth for the accepted skill ids on-chain.
///
/// Mirrors `SKILLS` in packages/shared-types/src/index.ts; the parity is pinned
/// by a test in that package rather than by hand here.
fn is_known_skill(skill: &str) -> bool {
    matches!(
        skill,
        "solana-anchor"
            | "typescript"
            | "java"
            | "python"
            | "go"
            | "rust"
            | "solidity"
    )
}

/// `0` -> default TTL. Otherwise must be in the future and within the ceiling.
fn resolve_expiry(requested: i64, now: i64) -> Result<i64> {
    let expiry = if requested > 0 { requested } else { now + DEFAULT_TTL_SECONDS };
    require!(
        expiry > now && expiry <= now + MAX_TTL_SECONDS,
        ErrorCode::InvalidExpiry
    );
    Ok(expiry)
}

/// Copy into a fixed-width buffer, rejecting over-long input.
///
/// Previously this silently truncated, which for the `schema` field would have
/// made two different skills collide on the same stored value.
fn pack_fixed<const N: usize>(src: &str) -> [u8; N] {
    let mut out = [0u8; N];
    let bytes = src.as_bytes();
    assert!(
        bytes.len() <= N,
        "pack_fixed: {}-byte value does not fit in {} bytes",
        bytes.len(),
        N
    );
    out[..bytes.len()].copy_from_slice(bytes);
    out
}