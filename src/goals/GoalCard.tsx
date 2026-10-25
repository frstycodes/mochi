import { Edit, Flag } from '@/icons';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { Thread } from '../model';
import { TooltipIconButton } from '../ui';
import { CriteriaList } from './CriteriaList';
import { SimilarWork } from './SimilarWork';
import { openGoalEditor } from './GoalEditor';

/** The thread's goal at the top of its transcript: the drafted outcome and what done means, one click from editing. */
export function GoalCard({ thread }: { thread: Thread }) {
  const criteria = thread.criteria ?? [];
  return (
    <Card size="sm" role="group" aria-label="Goal">
      <CardHeader>
        <CardDescription className="flex items-center gap-1 type-caption font-medium text-foreground">
          <Flag aria-hidden className="size-3.5" />
          Goal
        </CardDescription>
        <CardTitle className="text-pretty">{thread.goal}</CardTitle>
        <CardAction>
          <TooltipIconButton
            label="Edit goal"
            hint="Change the outcome or what done means"
            onClick={() => openGoalEditor(thread.id)}
          >
            <Edit />
          </TooltipIconButton>
        </CardAction>
      </CardHeader>
      {(criteria.length > 0 || !!thread.similar?.length) && (
        <CardContent className="flex flex-col gap-3">
          {criteria.length > 0 && <CriteriaList thread={thread} />}
          <SimilarWork thread={thread} />
        </CardContent>
      )}
    </Card>
  );
}
