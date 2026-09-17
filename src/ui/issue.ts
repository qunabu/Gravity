// "Something not right?" — a one-click path from whatever the user is looking
// at to a pre-filled GitHub issue. The current slide (or explore mode) and the
// deep link go into the body, so a report always says *where* it happened.

const REPO = 'https://github.com/qunabu/Gravity';

export function issueUrl(where: string): string {
  const title = `Something not right: ${where}`;
  const body = [
    `**Where:** ${where}`,
    `**Link:** ${location.href}`,
    '',
    '**What looks wrong?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    `<sub>${navigator.userAgent}</sub>`,
  ].join('\n');
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function openIssue(where: string): void {
  window.open(issueUrl(where), '_blank', 'noopener,noreferrer');
}
