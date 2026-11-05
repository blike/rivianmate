import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentFrame } from './LoadingState';

const frame = (stale?: boolean, height: number | string = 200) =>
  renderToStaticMarkup(
    <ContentFrame height={height} loading={false} stale={stale} empty={false} emptyText="None">
      <p>chart</p>
    </ContentFrame>,
  );

describe('ContentFrame', () => {
  it('dims the last period’s content under a note while the new one loads', () => {
    const html = frame(true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-stale="true"');
    expect(html).toContain('Loading');
    expect(html).toContain('<p>chart</p>');
  });

  it('shows loading, not "nothing here", when the last period had nothing', () => {
    const html = renderToStaticMarkup(
      <ContentFrame height={200} loading={false} stale empty emptyText="None">
        <p>chart</p>
      </ContentFrame>,
    );
    expect(html).toContain('Loading');
    expect(html).not.toContain('None');
  });

  it('shows this period’s content as it is', () => {
    const html = frame(false);
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('data-stale');
    expect(html).not.toContain('Loading');
  });

  it('leaves content bare where nothing says whether it is stale', () => {
    expect(frame()).toBe('<p>chart</p>');
  });

  it('fills a frame sized by its parent, for a map', () => {
    expect(frame(false, '100%')).toContain('style="height:100%"');
  });
});
