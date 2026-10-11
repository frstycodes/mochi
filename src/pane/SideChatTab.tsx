import { MessageAdd } from 'reicon-react';
import { PlannedTab } from './PlannedTab';

export function SideChatTab() {
  return <PlannedTab icon={MessageAdd} title="No side chat yet" description="Ask something without derailing this thread." />;
}
