import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarMonth, DayCalendar } from './DayCalendar';

const month = new Date(2026, 9, 1);
const render = (props: Partial<Parameters<typeof CalendarMonth>[0]> = {}) =>
  renderToStaticMarkup(
    <CalendarMonth
      noun="drive"
      month={month}
      onMonthChange={() => {}}
      counts={
        new Map([
          ['2026-10-03', 1],
          ['2026-10-14', 4],
        ])
      }
      selectedKey={null}
      onPick={() => {}}
      now={new Date(2026, 9, 20)}
      {...props}
    />,
  );

describe('CalendarMonth', () => {
  it("shows each day's count", () => {
    const html = render();
    expect(html).toMatch(/aria-label="[^"]*October 14: 4 drives"/);
    expect(html).toMatch(/aria-label="[^"]*October 3: 1 drive"/);
    expect(html).toMatch(/aria-label="[^"]*October 31: 0 drives"/);
  });

  it("can't pick a day without any, or step past this month", () => {
    const html = render();
    expect(html).toMatch(/disabled=""[^>]*aria-label="[^"]*October 5: 0 drives"/);
    expect(html).not.toMatch(/disabled=""[^>]*aria-label="[^"]*October 14:/);
    expect(html).toMatch(/aria-label="Next month" disabled=""/);
    expect(html).not.toMatch(/aria-label="Previous month" disabled=""/);
  });

  it('stops at the first month with any', () => {
    const html = render({ counts: undefined, earliest: new Date(2026, 9, 12) });
    expect(html).toMatch(/aria-label="Previous month" disabled=""/);
  });

  it('offers the month and the year as dropdowns', () => {
    const html = render();
    const october = month.toLocaleDateString([], { month: 'long' });
    expect(html.match(/aria-haspopup="listbox"/g)).toHaveLength(2);
    // Each shows the chosen one, sized to the longest it could show.
    const shown = (label: string) => `<span class="[grid-area:1/1] ">${label}</span>`;
    expect(html).toContain(shown(october));
    expect(html).toContain(shown('2026'));
    expect(html).toContain(
      `invisible">${new Date(2000, 8, 1).toLocaleDateString([], { month: 'long' })}</span>`,
    );
  });

  it('keeps a line for the count on days without any, so dates line up', () => {
    const html = render();
    expect(html).toMatch(/October 5: 0 drives"[^>]*>.*?<span[^>]*invisible[^>]*>0<\/span>/);
  });

  it('marks the picked day', () => {
    expect(render({ selectedKey: '2026-10-14' })).toMatch(
      /aria-pressed="true"[^>]*aria-label="[^"]*October 14:/,
    );
  });
});

describe('DayCalendar', () => {
  it('starts closed, as a button', () => {
    const html = renderToStaticMarkup(
      <DayCalendar
        noun="drive"
        month={month}
        onMonthChange={() => {}}
        counts={undefined}
        selectedKey={null}
        onPick={() => {}}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="dialog"');
    // Just the icon: no date or words beside it.
    expect(html).not.toContain('Go to date');
  });
});
