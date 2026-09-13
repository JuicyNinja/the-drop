/**
 * The Drop: architectural boundary lint rules.
 *
 * These two rules ARE the boundary described in CLAUDE.md ("Architectural
 * boundary") and BUILD-PLAN WP-1. They run at severity "error" and fail CI.
 *
 * Do not disable them. Do not downgrade them to "warn". Do not add
 * eslint-disable comments for them. They are what keeps a native client an
 * additive client instead of a backend rewrite.
 */

/** Module sources that only the server may touch. */
const BANNED_IN_UI = [
  /^@supabase\//, // any Supabase client package
  /(^|\/)lib\/supabase(\/|$)/, // our server-side Supabase wrapper
  /(^|\/)lib\/redis(\/|$)/, // our Redis wrapper
];

function isBannedInUi(source) {
  return BANNED_IN_UI.some((pattern) => pattern.test(source));
}

/**
 * Rule 1: no-supabase-in-ui
 *
 * No Supabase client import inside UI code. UI talks to `/v1` over HTTP, the
 * same way a native client does. The one sanctioned exception, realtime board
 * subscriptions (CLAUDE.md), lives in a wrapper module outside the UI tree
 * that exposes subscribe only; UI imports the wrapper, never the client.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noSupabaseInUi = {
  meta: {
    type: "problem",
    docs: {
      description:
        "UI code must not import a Supabase client. Every capability is reached through /v1 (CLAUDE.md invariant #15).",
    },
    messages: {
      banned:
        "'{{source}}' may not be imported from UI code. Call the /v1 API instead. See CLAUDE.md, Architectural boundary.",
    },
    schema: [],
  },
  create(context) {
    function check(node, source) {
      if (typeof source === "string" && isBannedInUi(source)) {
        context.report({ node, messageId: "banned", data: { source } });
      }
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        ) {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};

/**
 * Rule 2: no-server-actions
 *
 * The ban on `'use server'` is TOTAL, by design and not by limitation.
 *
 * A static linter cannot tell a read-only server action from a mutating one.
 * That does not matter, because the architectural requirement is that every
 * capability be reachable by a native client (CLAUDE.md invariant #15,
 * API-CONTRACT §0). A read-only server action is exactly as unreachable from
 * iOS as a mutating one. There is no "safe" server action to allow.
 *
 * Someone will propose narrowing this to "mutations only." Do not. Every
 * capability is an HTTP route handler under app/api/v1, described in
 * openapi.json, or it does not exist.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noServerActions = {
  meta: {
    type: "problem",
    docs: {
      description:
        "No 'use server' anywhere. Every capability is a /v1 route handler reachable by a native client.",
    },
    messages: {
      serverAction:
        "'use server' is banned. Server actions are unreachable from a native client. Put this behind a route handler under app/api/v1. See CLAUDE.md, Architectural boundary.",
    },
    schema: [],
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const isDirective =
          node.directive === "use server" ||
          (node.expression.type === "Literal" &&
            node.expression.value === "use server");
        if (isDirective) {
          context.report({ node, messageId: "serverAction" });
        }
      },
    };
  },
};

/**
 * Rule 3: no-dangerous-html
 *
 * `dangerouslySetInnerHTML` is banned outright (WP-3 security decision). All
 * merchant- and buyer-authored text — drop titles, descriptions, terms,
 * whisper notes, handles, org names — is rendered as text and sanitized on
 * write. An injected value reaching innerHTML is the XSS path that makes the
 * in-memory access token and everything else moot. Same enforcement level as
 * the other two: error, fails CI, no suppression.
 */
/** @type {import("eslint").Rule.RuleModule} */
const noDangerousHtml = {
  meta: {
    type: "problem",
    docs: {
      description:
        "dangerouslySetInnerHTML is banned. Authored text is rendered as text and sanitized on write.",
    },
    messages: {
      dangerousHtml:
        "dangerouslySetInnerHTML is banned. Render authored text as text; sanitize on write. See CLAUDE.md / API-CONTRACT §2.",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.name === "dangerouslySetInnerHTML") {
          context.report({ node, messageId: "dangerousHtml" });
        }
      },
      // Also catch React.createElement(..., { dangerouslySetInnerHTML })
      Property(node) {
        const key = node.key;
        const name =
          key?.type === "Identifier"
            ? key.name
            : key?.type === "Literal"
              ? key.value
              : undefined;
        if (name === "dangerouslySetInnerHTML") {
          context.report({ node, messageId: "dangerousHtml" });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "eslint-plugin-the-drop", version: "1.0.0" },
  rules: {
    "no-supabase-in-ui": noSupabaseInUi,
    "no-server-actions": noServerActions,
    "no-dangerous-html": noDangerousHtml,
  },
};

export default plugin;
