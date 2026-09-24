use anchor_lang::prelude::*;

declare_id!("8p8PNd75RdygjcmnvQMGW3U8Fr9AwgR21fSGSL7VBvAj");

pub const CREDENTIAL_SEED: &[u8] = b"credential";
pub const CREDENTIAL_DISCRIMINATOR: usize = 8;
pub const SCHEMA_LEN: usize = 32;
pub const ANALYZER_LEN: usize = 16;

// Fixed binary layout (after the 8-byte Anchor discriminator) — this is the
// ABI the verifier-sdk parses at exact offsets. Keep in sync with
// packages/verifier-sdk/src/layout.ts.
//
//   offset  size  field
//   0       32    authority       (issuer pubkey)
//   32      32    wallet          (subject pubkey)
//   64      32    schema          (b"pow.solana-anchor.v1\0…")
//   96      1     skill_score     (0..=100, confidence-shrunk)
//   97      1     confidence_pct  (0..=100)
//   98      1     level           (1=Verified 2=Strong 3=Expert)
//   99      1     issuer_tier     (1=automated)
//   100     32    evidence_root   (sha256 hex -> bytes)
//   132     16    analyzer_version(b"pow.solana-anchor\0…")
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MintCredentialArgs {
    pub skill: String,
    pub skill_score: u8,
    pub confidence_pct: u8,
    pub level: u8,
    pub evidence_root: [u8; 32],
    pub expires_at: i64,
}

#[derive(Accounts)]
#[instruction(args: MintCredentialArgs)]
pub struct MintCredential<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = CREDENTIAL_DISCRIMINATOR + Credential::LEN,
        seeds = [CREDENTIAL_SEED, wallet.key().as_ref(), args.skill.as_bytes()],
        bump
    )]
    pub credential: Account<'info, Credential>,
    pub wallet: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
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
    // Gate verifies a credential that already exists on-chain. The signer
    // (any wallet) proves they satisfy the bounty's threshold using the
    // credential owned by the ProofMesh issuer authority.
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
    pub authority: Signer<'info>,
    pub wallet: SystemAccount<'info>,
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
        require!(args.confidence_pct >= 60, ErrorCode::LowConfidence);
        require!(
            matches!(args.skill.as_str(), "solana-anchor" | "typescript" | "java"),
            ErrorCode::UnknownSkill
        );

        let now = Clock::get()?.unix_timestamp;
        let credential = &mut ctx.accounts.credential;
        credential.authority = ctx.accounts.authority.key();
        credential.wallet = ctx.accounts.wallet.key();
        credential.schema = pack_fixed::<{ SCHEMA_LEN }>(&args.skill);
        credential.skill_score = args.skill_score;
        credential.confidence_pct = args.confidence_pct;
        credential.level = args.level;
        credential.issuer_tier = 1;
        credential.evidence_root = args.evidence_root;
        credential.analyzer_version = pack_fixed::<{ ANALYZER_LEN }>("pow-analyzer");
        credential.status = 0; // ISSUED
        credential.issued_at = now;
        credential.expires_at = if args.expires_at > 0 { args.expires_at } else { now + 180 * 86400 };
        Ok(())
    }

    pub fn revoke_credential(ctx: Context<RevokeCredential>, _revoke_skill: String) -> Result<()> {
        ctx.accounts.credential.status = 2; // REVOKED
        Ok(())
    }

    pub fn claim_verified(ctx: Context<ClaimVerified>, args: GateArgs) -> Result<()> {
        let c = &ctx.accounts.credential;
        let now = Clock::get()?.unix_timestamp;

        require!(c.status == 0, ErrorCode::CredentialClosed);
        require!(now < c.expires_at, ErrorCode::CredentialExpired);
        require!(
            c.skill_score >= args.min_score && args.min_score <= 100,
            ErrorCode::BelowMinScore
        );
        require!(
            c.confidence_pct >= args.min_confidence_pct,
            ErrorCode::BelowMinConfidence
        );
        if args.issuer_allowlist.len() > 0 {
            require!(
                args.issuer_allowlist.contains(&c.authority),
                ErrorCode::IssuerNotAllowlisted
            );
        }
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
}

fn pack_fixed<const N: usize>(src: &str) -> [u8; N] {
    let mut out = [0u8; N];
    let bytes = src.as_bytes();
    let n = bytes.len().min(N);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}