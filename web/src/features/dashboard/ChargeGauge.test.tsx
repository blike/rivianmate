// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChargeGauge } from './ChargeGauge';

afterEach(cleanup);

const meter = () => screen.getByRole('meter', { name: 'Battery level' });
const limitMark = () => screen.getByText('Limit 70%').parentElement!;

describe('ChargeGauge', () => {
  it("says the pack is cold-limited in the cold's own color, above the limit's label", () => {
    render(<ChargeGauge level={61} limit={70} charging={false} verdict="cold" />);
    expect(screen.getByText('cold-limited').className).toContain('text-(--status-cold)');
    // A row of its own, so the band makes room for it.
    expect(meter().className).toContain('pt-10');
    expect(screen.getByText('Limit 70%')).toBeTruthy();
    expect(meter().getAttribute('aria-valuetext')).toBe(
      '61%, limit 70%, power output cold-limited',
    );
  });

  it('says nothing for a pack that is not limited: silence is the normal state', () => {
    render(<ChargeGauge level={61} limit={70} charging={false} verdict="normal" />);
    expect(screen.queryByText('normal')).toBeNull();
    expect(screen.queryByText('cold-limited')).toBeNull();
    // No label, so the band keeps the height it had before there was a verdict.
    expect(meter().className).toContain('pt-6');
    expect(meter().getAttribute('aria-valuetext')).toBe('61%, limit 70%');
  });

  it('leaves a vehicle that sends no verdict looking as it did before', () => {
    render(<ChargeGauge level={61} limit={70} charging={false} />);
    expect(screen.queryByText('cold-limited')).toBeNull();
    expect(screen.queryByText('normal')).toBeNull();
    expect(meter().className).toContain('pt-6');
    expect(limitMark().className).toContain('top-0');
    expect(meter().getAttribute('aria-valuetext')).toBe('61%, limit 70%');
  });

  it('keeps the limit label where it was, whether or not there is a verdict', () => {
    const { unmount } = render(<ChargeGauge level={61} limit={70} charging={false} />);
    const before = limitMark().getAttribute('style');
    unmount();
    render(<ChargeGauge level={61} limit={70} charging={false} verdict="cold" />);
    expect(limitMark().getAttribute('style')).toBe(before);
    expect(limitMark().getAttribute('style')).toBe('left: 70%; transform: translateX(-50%);');
  });

  it('holds the cold-limited label at either end of the gauge inside it, as the limit label does', () => {
    render(<ChargeGauge level={10} limit={100} charging={false} verdict="cold" />);
    expect(screen.getByText('cold-limited').getAttribute('style')).toBe(
      'left: 100%; transform: translateX(-100%);',
    );
    expect(screen.getByText('Limit 100%').parentElement!.getAttribute('style')).toBe(
      'left: 100%; transform: translateX(-100%);',
    );
  });

  it('gives a verdict without a limit the band a lone label needs', () => {
    render(<ChargeGauge level={61} limit={null} charging={false} verdict="cold" />);
    expect(meter().className).toContain('pt-6');
    expect(screen.getByText('cold-limited').getAttribute('style')).toBe('left: 0px;');
  });
});
