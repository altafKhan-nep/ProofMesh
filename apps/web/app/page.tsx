import { GlobalHeader } from '../components/GlobalHeader';
import { GlobalFooter } from '../components/GlobalFooter';
import { Hero } from '../components/Hero';
import { LiveReport } from '../components/LiveReport';
import { Pipeline } from '../components/Pipeline';
import { ProtocolCard } from '../components/ProtocolCard';

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1">
        <Hero />
        <Pipeline />
        <LiveReport />
        <ProtocolCard />
      </main>
      <GlobalFooter />
    </div>
  );
}