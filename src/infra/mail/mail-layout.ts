import { escapeHtml } from './mjml';

export const MAIL_COLORS = {
  ink: '#1f2933',
  muted: '#6b7785',
  page: '#f3f4f6',
  card: '#ffffff',
  accent: '#3654d9',
  danger: '#b42318',
} as const;

export interface LayoutInput {
  subject: string;
  preheader?: string;
  /** MJML fragment (mj-text, mj-table, ...) placed inside the card column. */
  body: string;
  /** Adds the "View in Atrium" button. */
  action?: { label: string; url: string };
  highPriority?: boolean;
}

/**
 * Shared Atrium email layout: "Atrium" wordmark header, white card with the body and an
 * optional action button, "Acme IT Services · demo" footer.
 */
export function renderLayout(input: LayoutInput): string {
  const badge = input.highPriority
    ? `<mj-text font-size="12px" font-weight="700" color="${MAIL_COLORS.danger}" padding="0 0 8px">HIGH PRIORITY</mj-text>`
    : '';
  const button = input.action
    ? `<mj-button href="${escapeHtml(input.action.url)}">${escapeHtml(input.action.label)}</mj-button>`
    : '';
  return `<mjml>
  <mj-head>
    <mj-title>${escapeHtml(input.subject)}</mj-title>
    ${input.preheader ? `<mj-preview>${escapeHtml(input.preheader)}</mj-preview>` : ''}
    <mj-attributes>
      <mj-all font-family="'Segoe UI', Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="1.6" color="${MAIL_COLORS.ink}" padding="6px 0" />
      <mj-button background-color="${MAIL_COLORS.accent}" color="#ffffff" border-radius="6px" font-size="15px" font-weight="600" inner-padding="12px 22px" padding="16px 0 8px" align="left" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="${MAIL_COLORS.page}" width="600px">
    <mj-section padding="28px 24px 12px">
      <mj-column>
        <mj-text font-size="22px" font-weight="700" letter-spacing="-0.4px" color="${MAIL_COLORS.ink}" padding="0">Atrium</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="${MAIL_COLORS.card}" border-radius="10px" padding="20px 28px">
      <mj-column>
        ${badge}
        ${input.body}
        ${button}
      </mj-column>
    </mj-section>
    <mj-section padding="16px 24px 32px">
      <mj-column>
        <mj-text font-size="12px" color="${MAIL_COLORS.muted}" align="center" padding="0">Acme IT Services · demo</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
