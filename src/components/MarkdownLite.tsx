import React from 'react';

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
const HEADING_PATTERN = /^#{1,6}\s+/;
const BULLET_PATTERN = /^\s*[-*•]\s+/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+/;
const RULE_PATTERN = /^\s*[-*_]{3,}\s*$/;

function renderInline(text: string): React.ReactNode[] {
  return text.split(INLINE_PATTERN).filter((part) => part.length > 0).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} style={{ color: '#e0e0e0', fontWeight: 700 }}>{renderInline(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="chat-md-code" style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 5px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.92em' }}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={index}>{renderInline(part.slice(1, -1))}</em>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

/**
 * Renderiza o markdown básico do assistente como elementos React.
 * Nada passa por HTML cru: o texto do modelo nunca vira marcação injetada.
 */
export const MarkdownLite: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(<p key={`p${blocks.length}`} style={{ margin: '0 0 6px' }}>{renderInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index} style={{ marginBottom: 3 }}>{renderInline(item)}</li>);
    blocks.push(
      list.ordered
        ? <ol key={`l${blocks.length}`} style={{ margin: '0 0 6px', paddingLeft: 20 }}>{items}</ol>
        : <ul key={`l${blocks.length}`} style={{ margin: '0 0 6px', paddingLeft: 18, listStyleType: 'disc' }}>{items}</ul>,
    );
    list = null;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (line.trim() === '') {
      flushList();
      flushParagraph();
      return;
    }
    if (RULE_PATTERN.test(line)) {
      flushList();
      flushParagraph();
      blocks.push(<hr key={`r${blocks.length}`} style={{ border: 'none', borderTop: '1px solid #2a2a2a', margin: '8px 0' }} />);
      return;
    }
    if (HEADING_PATTERN.test(line)) {
      flushList();
      flushParagraph();
      blocks.push(<strong key={`h${blocks.length}`} style={{ display: 'block', color: '#e0e0e0', fontSize: 13, fontWeight: 700, margin: '2px 0 6px' }}>{renderInline(line.replace(HEADING_PATTERN, ''))}</strong>);
      return;
    }
    const bullet = BULLET_PATTERN.test(line);
    const ordered = !bullet && ORDERED_PATTERN.test(line);
    if (bullet || ordered) {
      flushParagraph();
      const kind = bullet ? false : true;
      if (!list || list.ordered !== kind) {
        flushList();
        list = { ordered: kind, items: [] };
      }
      list.items.push(line.replace(bullet ? BULLET_PATTERN : ORDERED_PATTERN, ''));
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });

  flushList();
  flushParagraph();

  return <div className="chat-md">{blocks}</div>;
};
