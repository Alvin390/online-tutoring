import { useModes } from '@shared/config/modesStore';

/**
 * 013Fixes / 35: the demo preset is on — a "DEMO" ribbon on every page, for
 * teachers and students, so nobody takes a demo for the real school.
 */
export default function DemoRibbon() {
  const { demo } = useModes();
  if (!demo) return null;
  return (
    <div className="bg-warning text-dark text-center small fw-semibold py-1 px-2" role="status" data-testid="demo-ribbon">
      DEMO: payments are test payments and SMS are not sent.
    </div>
  );
}
