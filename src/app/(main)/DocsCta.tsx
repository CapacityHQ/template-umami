import { Tooltip, TooltipTrigger } from '@umami/react-zen';
import { IconLabel } from '@/components/common/IconLabel';
import { useMessages } from '@/components/hooks';
import { BookText } from '@/components/icons';
import { ADD_WEBSITE_DOCS_URL } from '@/lib/constants';
import styles from './DocsCta.module.css';

export interface DocsCtaProps {
  isCollapsed?: boolean;
}

export function DocsCta({ isCollapsed }: DocsCtaProps) {
  const { t, labels } = useMessages();
  const label = t(labels.documentation);

  const link = (
    <a
      data-test="docs-cta"
      href={ADD_WEBSITE_DOCS_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className={`${styles.cta} ${isCollapsed ? styles.collapsed : ''}`}
    >
      <IconLabel
        icon={<BookText />}
        label={isCollapsed ? '' : label}
        labelProps={{ className: styles.label }}
        padding
      />
    </a>
  );

  if (!isCollapsed) {
    return link;
  }

  return (
    <TooltipTrigger delay={0}>
      {link}
      <Tooltip placement="right">{label}</Tooltip>
    </TooltipTrigger>
  );
}
