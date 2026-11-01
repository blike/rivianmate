import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Select, matchOptions } from './SettingsControls';

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
