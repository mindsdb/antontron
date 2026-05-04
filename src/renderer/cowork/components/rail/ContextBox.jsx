// Context card — project + global memories. Slim variant by default
// per spec ("one line header, no underline").

import { RailCard } from './RailCard';
import { ContextCard } from './ContextCard';

export function ContextBox({
  project,
  defaultOpen = true,
  maxBodyHeight = 360,
  slim = true,
}) {
  return (
    <RailCard title="Context" defaultOpen={defaultOpen} slim={slim} maxBodyHeight={maxBodyHeight}>
      <ContextCard project={project} />
    </RailCard>
  );
}
