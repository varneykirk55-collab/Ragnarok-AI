"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-400">
        <span className="font-mono">{lang || "code"}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="!mt-0 !rounded-t-none">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            // Extract code content for copy button
            const child = React.Children.toArray(children)[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
            const className = child?.props?.className || "";
            const lang = /language-(\w+)/.exec(className)?.[1] || "";
            const code = String(child?.props?.children ?? "").replace(/\n$/, "");
            if (child) return <CodeBlock code={code} lang={lang} />;
            return <pre>{children}</pre>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
