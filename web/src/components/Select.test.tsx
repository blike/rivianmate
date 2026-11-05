import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select, matchOptions } from './Select';

const zones = ['America/Los_Angeles', 'America/Chicago', 'Europe/London'].map((z) => ({
  value: z,
  label: z,
}));

describe('matchOptions', () => {
  it('finds a name anywhere in it, ignoring case and underscores', () => {
    expect(matchOptions(zones, 'chicago').map((o) => o.value)).toEqual(['America/Chicago']);
    expect(matchOptions(zones, 'los ang').map((o) => o.value)).toEqual(['America/Los_Angeles']);
  });

  it('keeps everything with nothing typed, and nothing with no match', () => {
    expect(matchOptions(zones, '  ')).toHaveLength(3);
    expect(matchOptions(zones, 'mars')).toEqual([]);
  });
});

describe('Select', () => {
  it("draws the app's own closed control, showing the chosen label", () => {
    const html = renderToStaticMarkup(
      <Select
        id="car"
        label="Vehicle"
        value="v1"
        options={[{ value: 'v1', label: 'Storm' }]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('Storm');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('id="car"');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('role="listbox"');
  });
});

describe('Select, grouped', () => {
  it('draws a trigger of its own, named for screen readers', () => {
    const html = renderToStaticMarkup(
      <Select
        label="Vehicle"
        value="v1"
        options={[
          { value: 'v1', label: 'Storm', detail: '2025 R1S', group: 'Rivian' },
          { value: 'v2', label: 'Model 3', group: 'TeslaMate' },
        ]}
        trigger={(open) => <span>{open ? 'open' : 'closed'} card</span>}
        triggerClassName="nav-card"
        onChange={() => {}}
      />,
    );
    expect(html).toContain('closed card');
    expect(html).toContain('nav-card');
    expect(html).toContain('aria-label="Vehicle: Storm"');
    // The chip's chevron is the chip's; a custom trigger brings its own.
    expect(html).not.toContain('M2.5 4.5 6 8l3.5-3.5');
  });
});

describe('Select, in muted text', () => {
  it('keeps its own text color rather than taking the line around it', () => {
    const html = renderToStaticMarkup(
      <span className="text-(--text-muted)">
        <Select label="Driver" compact value="a" options={['a', 'b']} onChange={() => {}} />
      </span>,
    );
    expect(html).toMatch(/aria-haspopup="listbox"[^>]*class="[^"]*text-\(--text-primary\)/);
  });
});

describe('Select, holding its width', () => {
  it('lays every label in one cell, showing only the chosen one', () => {
    const html = renderToStaticMarkup(
      <Select
        label="Month"
        value="4"
        options={[{ value: '4', label: 'May' }]}
        widthOf={['May', 'November', 'September']}
        onChange={() => {}}
      />,
    );
    expect(html).toMatch(/<span class="\[grid-area:1\/1\] ">May<\/span>/);
    expect(html).toMatch(/<span class="\[grid-area:1\/1\] invisible">November<\/span>/);
    expect(html.match(/>May</g)).toHaveLength(1);
  });
});
