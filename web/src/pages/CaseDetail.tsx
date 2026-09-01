import { useEffect, useState } from 'react';

export function CaseDetail({ caseId, onBack }: { caseId: string, onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);

  const load = async () => {
    try {
      const c = await fetch(`/api/cases/${caseId}`).then(r => r.json());
      const a = await fetch('/api/audit').then(r => r.json());
      setData(c);
      setAudit(a.filter((e: any) => e.caseId === caseId));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [caseId]);

  if (!data) return <div className="text-zinc-500">Loading...</div>;

  const hasAI = audit.some(e => e.type === 'AGENT_RUN_COMPLETED');
  const govEvent = audit.find(e => e.type === 'POLICY_EVALUATED');
  const actionExecuted = audit.find(e => e.type === 'ACTION_EXECUTION_SUCCEEDED');
  const actionBlocked = audit.find(e => e.type === 'ACTION_EXECUTION_FAILED');
  const verified = audit.find(e => e.type === 'VERIFICATION_SUCCEEDED');

  return (
    <div className="space-y-8 pb-20">
      <button onClick={onBack} className="text-zinc-400 hover:text-white text-sm mb-4">
        &larr; Back to Cases
      </button>

      <div className="border-b border-zinc-800 pb-6">
        <div className="text-emerald-400 font-mono text-sm mb-2 uppercase">{data.type}</div>
        <h2 className="text-3xl font-semibold text-white">{data.title}</h2>
        <div className="flex items-center space-x-4 mt-4 text-sm">
          <div className="text-zinc-500 font-mono">{data.id}</div>
          <div className={`px-2 py-1 font-bold rounded ${
            data.status === 'RESOLVED' ? 'bg-emerald-950 text-emerald-400' :
            data.status === 'ACTION_REQUIRED' ? 'bg-amber-950 text-amber-400' :
            'bg-zinc-800 text-zinc-300'
          }`}>
            {data.status}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div className="space-y-8">
          <h3 className="text-lg font-medium text-white border-b border-zinc-800 pb-2">Operational Workflow</h3>
          
          {hasAI && (
            <div className="bg-zinc-800/20 border border-zinc-700 p-4 rounded">
              <div className="text-xs font-mono text-zinc-500 mb-2">AI DECISION</div>
              <div className="text-sm text-zinc-300 mb-2">PROPOSE_ACTION: CREATE_PURCHASE_ORDER</div>
              <div className="bg-black/50 p-3 rounded font-mono text-xs text-zinc-400 whitespace-pre-wrap">
                {JSON.stringify(audit.find(e => e.type === 'AGENT_RUN_COMPLETED')?.data?.decision?.action, null, 2)}
              </div>
            </div>
          )}

          {govEvent && (
            <div className="bg-zinc-800/20 border border-zinc-700 p-4 rounded">
              <div className="text-xs font-mono text-zinc-500 mb-2">GOVERNANCE</div>
              <div className={`text-sm font-medium ${govEvent.data.decision === 'ALLOW' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {govEvent.data.decision}
              </div>
              <div className="text-xs text-zinc-400 mt-2">{govEvent.data.reason}</div>
            </div>
          )}

          {(actionExecuted || actionBlocked) && (
            <div className="bg-zinc-800/20 border border-zinc-700 p-4 rounded">
              <div className="text-xs font-mono text-zinc-500 mb-2">ACTION EXECUTION</div>
              {actionExecuted ? (
                <div className="text-sm text-emerald-400 font-medium">✓ SUCCEEDED</div>
              ) : (
                <>
                  <div className="text-sm text-red-400 font-medium">✕ BLOCKED / FAILED</div>
                  <div className="text-xs text-zinc-400 mt-2">{actionBlocked?.data?.error}</div>
                </>
              )}
            </div>
          )}

          {verified && (
            <div className="bg-emerald-950/30 border border-emerald-900 p-4 rounded">
              <div className="text-xs font-mono text-emerald-500 mb-2">INDEPENDENT VERIFICATION</div>
              <div className="text-sm text-emerald-400 font-medium">✓ VERIFIED</div>
              <div className="text-xs text-emerald-600 mt-1">Authoritative state matches executed intent.</div>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-lg font-medium text-white border-b border-zinc-800 pb-2 mb-6">Audit Trail</h3>
          <div className="space-y-4">
            {audit.map((e, i) => (
              <div key={i} className="flex space-x-4">
                <div className="text-xs text-zinc-500 font-mono pt-1">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-300">{e.type}</div>
                  <div className="text-xs text-zinc-500 mt-1">{e.actor}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
