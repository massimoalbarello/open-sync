import { Link } from '@tanstack/react-router';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const assetPath = /^\/api\/receiver\/assets\/(asset_[0-9a-f-]{36})$/;

export function MarkdownContent({ body }: { body: string }) {
  return (
    <div className="readable-content">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          a: ({ href, children }) => {
            const asset = href?.match(assetPath)?.[1];
            return asset ? (
              <Link to="/assets/$id" params={{ id: asset }}>
                {children}
              </Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const asset = typeof src === 'string' ? src.match(assetPath)?.[1] : undefined;
            return asset ? (
              <img src={`/api/receiver/assets/${asset}/preview`} alt={alt ?? ''} loading="lazy" />
            ) : (
              <a
                href={typeof src === 'string' ? src : undefined}
                target="_blank"
                rel="noreferrer noopener"
              >
                {alt || 'Open external image'}
              </a>
            );
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
