import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('gives every heading the same line, with an action beside it or not', () => {
    const plain = renderToStaticMarkup(<Panel title="Route">body</Panel>);
    const withAction = renderToStaticMarkup(
      <Panel title="All drives" action={<button>Pick</button>}>
        body
      </Panel>,
    );
    const heading =
      /<div class="-mt-2 flex min-h-8[^"]* mb-2"><h3 class="eyebrow text-\(--text-secondary\)">/;
    expect(plain).toMatch(heading);
    expect(withAction).toMatch(heading);
    expect(withAction).toContain('<button>Pick</button>');
  });

  it('pads the whole card, or with flush only its heading', () => {
    expect(renderToStaticMarkup(<Panel title="Places">body</Panel>)).toMatch(
      /<section class="card p-5 ">/,
    );
    const flush = renderToStaticMarkup(
      <Panel title="Routes driven" flush>
        map
      </Panel>,
    );
    expect(flush).toMatch(/<section class="card overflow-hidden ">/);
    expect(flush).toMatch(/<div class="px-5 pt-5"><div class="-mt-2/);
  });

  it('keeps a heading-like first line close with tight', () => {
    const html = renderToStaticMarkup(
      <Panel title="Average efficiency" tight>
        2.88
      </Panel>,
    );
    expect(html).toMatch(/<div class="-mt-2 flex min-h-8[^"]*"><h3/);
    expect(html).not.toMatch(/min-h-8[^"]* mb-2"/);
  });
});
