import { useState } from 'react';

export function DemoScenarios({ onSelectCase }: { onSelectCase: (id: string) => void }) {
  const [running, setRunning] = useState<string | null>(null);

  const runDemo = async (endpoint: string) => {
    setRunning(endpoint);
    try {
      const res = await fetch(endpoint, { method: 'POST' }).then(r => r.json());
      if (res.caseId) {
        onSelectCase(res.caseId);
      } else {
        alert("Failed: " + JSON.stringify(res));
      }
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setRunning(null);
    }
  };

  const ScenarioCard = ({ title, desc, endpoint }: { title: string, desc: string, endpoint: string }) => (
    <div className="bg-zinc-800/30 border border-zinc-800 p-6 rounded-lg">
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-sm text-zinc-400 mb-6">{desc}</p>
      <button 
        onClick={() => runDemo(endpoint)}
        disabled={!!running}
        className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-4 py-2 rounded text-sm disabled:opacity-50 transition-colors"
      >
        {running === endpoint ? "Running..." : "Run Scenario"}
      </button>
    </div>
  );

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold text-white">Demo Scenarios</h2>
      <p className="text-zinc-400 max-w-2xl">
        Execute end-to-end operational scenarios. These scenarios exercise the real backend pipeline
        from event ingestion through AI reasoning, governance evaluation, execution, and verification.
      </p>

      <div className="grid gap-6">
        <ScenarioCard 
          title="Scenario A — Happy Path" 
          desc="Simulates a standard low inventory event. The AI proposes a purchase order which is within the automatic approval limit. Governance allows it, the action executes, and is independently verified."
          endpoint="/api/demo/low-inventory"
        />
        
        <ScenarioCard 
          title="Scenario B — Governance Protection" 
          desc="Simulates a massive inventory deficit. The AI proposes a very large purchase order. Deterministic governance blocks it because it exceeds the max auto-order policy."
          endpoint="/api/demo/governance"
        />

        <ScenarioCard 
          title="Scenario C — Parameter Tampering" 
          desc="Demonstrates exact structural parameter binding. The AI proposes a valid action and Governance allows it. Before execution, the quantity is tampered with. Execution is rejected."
          endpoint="/api/demo/tampering"
        />
      </div>
    </div>
  );
}
