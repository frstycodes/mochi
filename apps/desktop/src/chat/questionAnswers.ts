/** The question form's answers: one list of picked labels per question, plus one typed answer per question. */

/** Picks an option: a single choice replaces, a multiple choice toggles. */
export function pick(
  answers: string[][],
  at: number,
  option: string,
  isMulti: boolean,
): string[][] {
  return answers.map((a, i) => {
    if (i !== at) return a;
    if (!isMulti) return [option];
    return a.includes(option) ? a.filter((x) => x !== option) : [...a, option];
  });
}

export const isAnswered = (answers: string[][], other: string[], at: number) =>
  answers[at].length > 0 || other[at].trim().length > 0;

/** Where Next or Skip goes from `at`: the next question, or sending after the last. */
export const stepAfter = (at: number, total: number): number | 'send' =>
  at >= total - 1 ? 'send' : at + 1;

/** Skipping leaves a question unanswered: whatever was half-picked or typed on it goes. */
export const clearAt = <T>(list: T[], at: number, empty: T): T[] =>
  list.map((x, i) => (i === at ? empty : x));

/** What gets sent: each question's picks plus its typed answer. An unanswered (skipped) question sends nothing. */
export function finalAnswers(answers: string[][], other: string[]): string[][] {
  return answers.map((a, i) => {
    const typed = other[i].trim();
    return typed ? [...a, typed] : a;
  });
}
