import { GlobalHeader } from '@/components/GlobalHeader';
import { GlobalFooter } from '@/components/GlobalFooter';
import { SpecSheet } from '@/components/SpecSheet';

export default function ComponentsPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1">
        <div className="fixed inset-0 grid-bg pointer-events-none z-0 opacity-70"></div>
        <div className="relative z-10">
          <SpecSheet />
        </div>
      </main>
      <GlobalFooter />
    </div>
  );
}