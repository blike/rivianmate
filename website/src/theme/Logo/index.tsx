import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import type { Props } from '@theme/Logo';
import type { ReactNode } from 'react';

/**
 * The app's wordmark (web/src/components/AppNav.tsx): "Rivian" in the text
 * color, "Mate" in the accent, beside the headlights icon.
 */
export default function Logo({ imageClassName, titleClassName, ...props }: Props): ReactNode {
  const home = useBaseUrl('/');
  const icon = useBaseUrl('img/icon.svg');
  return (
    <Link to={home} {...props} aria-label="RivianMate home">
      <div className="navbar__logo">
        <img className={imageClassName} src={icon} alt="" width={28} height={28} />
      </div>
      <b className={titleClassName}>
        Rivian<span className="rm-wordmark-accent">Mate</span>
      </b>
    </Link>
  );
}
