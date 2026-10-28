import type { ReactNode } from 'react';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { FollowedMachine } from '../host/types/remote';
import { LeafBar } from '../layout/SplitControls';
import { findAnyThread } from '../store/anyThread';
import { parseRemoteThreadId } from './ids';
import { DeviceIndicator } from './origin';
import { RemoteThreadScope } from './RemoteThreadScope';
import { machineStatus } from './status';
import { useMachines } from './useMachines';

/**
 * A split's view of another computer's thread or one of its pane tabs: `children` under that computer's store
 * (`RemoteThreadScope`) once its stream has the thread, else why it isn't here.
 */
export function RemoteThreadLeaf({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  const { machines } = useMachines();
  const machineId = parseRemoteThreadId(threadId)?.machineId;
  const followed = machines.find((m) => m.machine.id === machineId);
  const found = findAnyThread(undefined, machines, threadId);
  if (!followed)
    return (
      <Missing
        title="Not paired anymore"
        description="This computer no longer follows the one this thread runs on."
      />
    );
  const { machine, state } = followed;
  if (!state)
    return (
      <Missing
        machine={machine}
        title={
          machine.status === 'connecting'
            ? `Connecting to ${machine.name}…`
            : `${machine.name} is offline`
        }
        description={
          machineStatus(machine) ?? 'Its threads show here once it sends them.'
        }
        isLoading={machine.status === 'connecting'}
      />
    );
  if (!found)
    return (
      <Missing
        machine={machine}
        title="This thread is gone"
        description={`It isn’t on ${machine.name} anymore.`}
      />
    );
  return (
    <RemoteThreadScope machine={machine} mirror={state}>
      {children}
    </RemoteThreadScope>
  );
}

function Missing({
  machine,
  title,
  description,
  isLoading,
}: {
  machine?: FollowedMachine;
  title: string;
  description: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <LeafBar>
        {!!machine && <DeviceIndicator machine={machine} />}
        {machine?.name ?? 'Another computer'}
      </LeafBar>
      <Empty className="flex-1">
        <EmptyHeader>
          {isLoading && <Spinner />}
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
