import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Segmented } from './Segmented';

const render = (size?: 'sm' | 'md') =>
  renderToStaticMarkup(
    <Segmented
      label="Window"
      value={30}
      options={[7, 30, 90].map((d) => ({ value: d, label: `${d}d` }))}
      onChange={() => {}}
      size={size}
    />,
  );

describe('Segmented', () => {
  it('is a group of options with the chosen one checked', () => {
    const html = render();
    expect(html).toContain('role="radiogroup" aria-label="Window"');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/aria-checked="true" tabindex="0" data-value="30"/);
    expect(html.match(/aria-checked="false" tabindex="-1"/g)).toHaveLength(2);
  });

  it('comes in a size for beside larger text', () => {
    expect(render()).toContain('px-2.5 py-1 text-xs');
    expect(render('md')).toContain('px-3.5 py-1.5 text-sm');
  });
});
