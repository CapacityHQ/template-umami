import { Accordion, AccordionItem, Code, Column, Icon, Row, Text } from '@umami/react-zen';
import { LinkButton } from '@/components/common/LinkButton';
import { ExternalLink, TriangleAlert } from '@/components/icons';
import {
  DEV_DEFAULT_PASSWORD,
  DEV_DEFAULT_USERNAME,
  IS_DEVELOPMENT,
  LOGIN_DOCS_URL,
} from '@/lib/constants';
import styles from './DevModeNotice.module.css';

export function DevModeNotice() {
  if (!IS_DEVELOPMENT) {
    return null;
  }

  return (
    <Accordion
      data-test="dev-mode-notice"
      className={styles.root}
      defaultExpandedKeys={['dev-mode']}
    >
      <AccordionItem id="dev-mode" className={styles.item}>
        <span className={styles.trigger}>
          <Icon size="sm">
            <TriangleAlert />
          </Icon>
          Development mode
        </span>
        <Column gap="3" paddingX="4" paddingBottom="4">
          <Text size="sm">The login form is prefilled with the default credentials:</Text>
          <Column gap="1">
            <Row alignItems="center" gap="2">
              <Text size="sm">Username</Text>
              <Code size="sm" className={styles.credential}>
                {DEV_DEFAULT_USERNAME}
              </Code>
            </Row>
            <Row alignItems="center" gap="2">
              <Text size="sm">Password</Text>
              <Code size="sm" className={styles.credential}>
                {DEV_DEFAULT_PASSWORD}
              </Code>
            </Row>
          </Column>
          <Text size="sm">Change these credentials the first time you log in.</Text>
          <LinkButton
            href={LOGIN_DOCS_URL}
            target="_blank"
            variant="outline"
            size="sm"
            className={styles.link}
            asAnchor
          >
            <Row alignItems="center" gap="2">
              <Text size="sm">Read the login documentation</Text>
              <Icon size="xs">
                <ExternalLink />
              </Icon>
            </Row>
          </LinkButton>
        </Column>
      </AccordionItem>
    </Accordion>
  );
}
