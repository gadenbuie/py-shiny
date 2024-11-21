import { LitElement, html } from "lit";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { property } from "lit/decorators.js";

import ClipboardJS from "clipboard";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Renderer, parse } from "marked";

import { createElement } from "./_utils";

type ContentType = "markdown" | "html" | "text";

type Message = {
  content: string;
  role: "user" | "assistant";
  chunk_type: "message_start" | "message_end" | null;
  content_type: ContentType;
};
type ShinyChatMessage = {
  id: string;
  handler: string;
  obj: Message;
};

type requestScrollEvent = {
  cancelIfScrolledUp: boolean;
};

type UpdateUserInput = {
  value?: string;
  placeholder?: string;
  attachments?: ChatInputAttachment[];
};

// https://github.com/microsoft/TypeScript/issues/28357#issuecomment-748550734
declare global {
  interface GlobalEventHandlersEventMap {
    "shiny-chat-input-sent": CustomEvent<Message>;
    "shiny-chat-append-message": CustomEvent<Message>;
    "shiny-chat-append-message-chunk": CustomEvent<Message>;
    "shiny-chat-clear-messages": CustomEvent;
    "shiny-chat-update-user-input": CustomEvent<UpdateUserInput>;
    "shiny-chat-remove-loading-message": CustomEvent;
    "shiny-chat-request-scroll": CustomEvent<requestScrollEvent>;
  }
}

const CHAT_MESSAGE_TAG = "shiny-chat-message";
const CHAT_USER_MESSAGE_TAG = "shiny-user-message";
const CHAT_MESSAGES_TAG = "shiny-chat-messages";
const CHAT_INPUT_TAG = "shiny-chat-input";
const CHAT_CONTAINER_TAG = "shiny-chat-container";

const ICONS = {
  robot:
    '<svg fill="currentColor" class="bi bi-robot" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M6 12.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M3 8.062C3 6.76 4.235 5.765 5.53 5.886a26.6 26.6 0 0 0 4.94 0C11.765 5.765 13 6.76 13 8.062v1.157a.93.93 0 0 1-.765.935c-.845.147-2.34.346-4.235.346s-3.39-.2-4.235-.346A.93.93 0 0 1 3 9.219zm4.542-.827a.25.25 0 0 0-.217.068l-.92.9a25 25 0 0 1-1.871-.183.25.25 0 0 0-.068.495c.55.076 1.232.149 2.02.193a.25.25 0 0 0 .189-.071l.754-.736.847 1.71a.25.25 0 0 0 .404.062l.932-.97a25 25 0 0 0 1.922-.188.25.25 0 0 0-.068-.495c-.538.074-1.207.145-1.98.189a.25.25 0 0 0-.166.076l-.754.785-.842-1.7a.25.25 0 0 0-.182-.135"/><path d="M8.5 1.866a1 1 0 1 0-1 0V3h-2A4.5 4.5 0 0 0 1 7.5V8a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1v-.5A4.5 4.5 0 0 0 10.5 3h-2zM14 7.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7.5A3.5 3.5 0 0 1 5.5 4h5A3.5 3.5 0 0 1 14 7.5"/></svg>',
  // https://github.com/n3r4zzurr0/svg-spinners/blob/main/svg-css/3-dots-fade.svg
  dots_fade:
    '<svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><style>.spinner_S1WN{animation:spinner_MGfb .8s linear infinite;animation-delay:-.8s}.spinner_Km9P{animation-delay:-.65s}.spinner_JApP{animation-delay:-.5s}@keyframes spinner_MGfb{93.75%,100%{opacity:.2}}</style><circle class="spinner_S1WN" cx="4" cy="12" r="3"/><circle class="spinner_S1WN spinner_Km9P" cx="12" cy="12" r="3"/><circle class="spinner_S1WN spinner_JApP" cx="20" cy="12" r="3"/></svg>',
  dot: '<svg width="12" height="12" xmlns="http://www.w3.org/2000/svg" class="chat-streaming-dot" style="margin-left:.25em;margin-top:-.25em"><circle cx="6" cy="6" r="6"/></svg>',
};

function createSVGIcon(icon: string): HTMLElement {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(icon, "image/svg+xml");
  return svgDoc.documentElement;
}

const SVG_DOT = createSVGIcon(ICONS.dot);

const requestScroll = (el: HTMLElement, cancelIfScrolledUp = false) => {
  el.dispatchEvent(
    new CustomEvent("shiny-chat-request-scroll", {
      detail: { cancelIfScrolledUp },
      bubbles: true,
      composed: true,
    })
  );
};

// For rendering chat output, we use typical Markdown behavior of passing through raw
// HTML (albeit sanitizing afterwards).
//
// For echoing chat input, we escape HTML. This is not for security reasons but just
// because it's confusing if the user is using tag-like syntax to demarcate parts of
// their prompt for other reasons (like <User>/<Assistant> for providing examples to the
// chat model), and those tags simply vanish.
const markdownDOMPurify = DOMPurify();
markdownDOMPurify.addHook("beforeSanitizeAttributes", (node) => {
  // Escape & in text content
  if (node.nodeName && node.nodeName === "#text" && node.textContent) {
    node.textContent = node.textContent.replaceAll("&", "&amp;");
  }
});

// From https://github.com/bevacqua/insane#defaults
const allowedTags = [
  "a",
  "article",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strike",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];
const escapeUnknownTags = (html: string): string =>
  html.replace(
    /<(\/?)([^ >]+)([^>]*)>/g,
    (_, slash = "", tag = "", extra = "") =>
      allowedTags.includes(tag.toLowerCase())
        ? `<${slash + tag + extra}>`
        : `&lt;${slash + tag + extra}&gt;`
  );

function contentToHTML(
  content: string,
  content_type: ContentType | "semi-markdown"
) {
  if (content_type == "markdown") {
    return unsafeHTML(markdownDOMPurify.sanitize(parse(content) as string));
  } else if (content_type == "semi-markdown") {
    return unsafeHTML(
      markdownDOMPurify.sanitize(escapeUnknownTags(parse(content) as string))
    );
  } else if (content_type === "html") {
    return unsafeHTML(DOMPurify.sanitize(content));
  } else if (content_type === "text") {
    return content;
  } else {
    throw new Error(`Unknown content type: ${content_type}`);
  }
}

// https://lit.dev/docs/components/shadow-dom/#implementing-createrenderroot
class LightElement extends LitElement {
  createRenderRoot() {
    return this;
  }
}

class ChatMessage extends LightElement {
  @property() content = "";
  @property() content_type: ContentType = "markdown";
  @property({ type: Boolean, reflect: true }) streaming = false;

  render(): ReturnType<LitElement["render"]> {
    const content = contentToHTML(this.content, this.content_type);

    const noContent = this.content.trim().length === 0;
    const icon = noContent ? ICONS.dots_fade : ICONS.robot;

    return html`
      <div class="message-icon">${unsafeHTML(icon)}</div>
      <div class="message-content">${content}</div>
    `;
  }

  updated(changedProperties: Map<string, unknown>): void {
    if (changedProperties.has("content")) {
      this.#highlightAndCodeCopy();
      if (this.streaming) this.#appendStreamingDot();
      // It's important that the scroll request happens at this point in time, since
      // otherwise, the content may not be fully rendered yet
      requestScroll(this, this.streaming);
    }
    if (changedProperties.has("streaming")) {
      this.streaming ? this.#appendStreamingDot() : this.#removeStreamingDot();
    }
  }

  #appendStreamingDot(): void {
    const content = this.querySelector(".message-content") as HTMLElement;
    content.lastElementChild?.appendChild(SVG_DOT);
  }

  #removeStreamingDot(): void {
    this.querySelector(".message-content svg.chat-streaming-dot")?.remove();
  }

  // Highlight code blocks after the element is rendered
  #highlightAndCodeCopy(): void {
    const el = this.querySelector("pre code");
    if (!el) return;
    this.querySelectorAll<HTMLElement>("pre code").forEach((el) => {
      // Highlight the code
      hljs.highlightElement(el);
      // Add a button to the code block to copy to clipboard
      const btn = createElement("button", {
        class: "code-copy-button",
        title: "Copy to clipboard",
      });
      btn.innerHTML = '<i class="bi"></i>';
      el.prepend(btn);
      // Add the clipboard functionality
      const clipboard = new ClipboardJS(btn, { target: () => el });
      clipboard.on("success", function (e: ClipboardJS.Event) {
        btn.classList.add("code-copy-button-checked");
        setTimeout(
          () => btn.classList.remove("code-copy-button-checked"),
          2000
        );
        e.clearSelection();
      });
    });
  }
}

class ChatUserMessage extends LightElement {
  @property() content = "...";
  @property() content_type: ContentType | "semi-markdown" = "semi-markdown";

  render(): ReturnType<LitElement["render"]> {
    return contentToHTML(this.content, this.content_type);
  }
}

class ChatMessages extends LightElement {
  render(): ReturnType<LitElement["render"]> {
    return html``;
  }
}

interface ChatInputAttachment {
  type: string;
  name: string;
  data: string;
}

class ChatInput extends LightElement {
  @property() placeholder = "Enter a message...";
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Array }) attachments: ChatInputAttachment[] = [];

  private get textarea(): HTMLTextAreaElement {
    return this.querySelector("textarea") as HTMLTextAreaElement;
  }

  private get value(): string {
    return this.textarea.value;
  }

  private get valueIsEmpty(): boolean {
    return this.value.trim().length === 0 && this.attachments.length === 0;
  }

  private get sendButton(): HTMLButtonElement {
    return this.querySelector(".btn-send-message") as HTMLButtonElement;
  }

  render(): ReturnType<LitElement["render"]> {
    const icon =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-arrow-up-circle-fill" viewBox="0 0 16 16"><path d="M16 8A8 8 0 1 0 0 8a8 8 0 0 0 16 0m-7.5 3.5a.5.5 0 0 1-1 0V5.707L5.354 7.854a.5.5 0 1 1-.708-.708l3-3a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 5.707z"/></svg>';

    return html`
      <div class="attachments" data-items="${this.attachments.length}">
        ${this.attachments.map(
          (attachment, index) => html`
            <div class="attachment">
              <button
                type="button"
                class="btn-attachment-close"
                aria-label="Delete attachment"
                @click="${() => this.#removeAttachment(index)}"
              >
                &times;
              </button>
              <img
                src="${attachment.data}"
                alt="${attachment.name} preview"
                class="attachment-thumbnail"
              />
            </div>
          `
        )}
      </div>
      <textarea
        id="${this.id}"
        class="form-control textarea-autoresize"
        rows="1"
        placeholder="${this.placeholder}"
        @keydown=${this.#onKeyDown}
        @input=${this.#onInput}
        @paste=${this.#onPaste}
        data-shiny-no-bind-input
      ></textarea>
      <button
        type="button"
        class="btn-send-message"
        title="Send message"
        aria-label="Send message"
        @click=${this.#sendInput}
      >
        ${unsafeHTML(icon)}
      </button>
    `;
  }

  #onPaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        event.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const base64 = await this.#blobToBase64(blob);
          const fileAttachment = {
            type: blob.type,
            name: blob.name,
            data: base64,
          };
          console.log("Attaching file", fileAttachment);
          this.attachments.push(fileAttachment);
          this.requestUpdate();
        }
      }
      this.#onInput();
    }
  };

  #blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  #removeAttachment = (index: number) => {
    this.attachments = this.attachments.filter((_, i) => i !== index);
    this.requestUpdate();
  };

  // Pressing enter sends the message (if not empty)
  #onKeyDown(e: KeyboardEvent): void {
    const isEnter = e.code === "Enter" && !e.shiftKey;
    if (isEnter && !this.valueIsEmpty) {
      e.preventDefault();
      this.#sendInput();
    }
  }

  #onInput(): void {
    this.sendButton.disabled = this.disabled ? true : this.valueIsEmpty;
  }

  // Determine whether the button should be enabled/disabled on first render
  protected firstUpdated(): void {
    this.#onInput();
  }

  // Recheck button state when `this.disabled` updates
  updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("disabled")) {
      this.#onInput();
    }
  }

  #sendInput(): void {
    if (this.valueIsEmpty) return;
    if (this.disabled) return;

    Shiny.setInputValue!(
      this.id,
      this.attachments.length
        ? JSON.stringify({ content: this.value, attachments: this.attachments })
        : this.value,
      { priority: "event" }
    );

    let message = this.value;
    for (const attachment of this.attachments) {
      if (attachment.type.indexOf("image") === -1) {
        continue;
      }
      message += `\n\n![](${attachment.data})`;
    }

    // Emit event so parent element knows to insert the message
    const sentEvent = new CustomEvent("shiny-chat-input-sent", {
      detail: { content: message, role: "user" },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(sentEvent);

    this.setInputValue({ content: "" });

    this.textarea.focus();
    this.disabled = true; // Will be re-enabled by #finalizeMessage() when we get a response
  }

  setInputValue({
    content,
    attachments = [],
  }: {
    content: string;
    attachments?: ChatInputAttachment[];
  }): void {
    this.textarea.value = content;

    // Simulate an input event (to trigger the textarea autoresize)
    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    this.textarea.dispatchEvent(inputEvent);

    if (attachments) {
      this.attachments = attachments;
      this.requestUpdate();
    }
  }
}

class ChatContainer extends LightElement {
  @property() placeholder = "Enter a message...";

  private get input(): ChatInput {
    return this.querySelector(CHAT_INPUT_TAG) as ChatInput;
  }

  private get messages(): ChatMessages {
    return this.querySelector(CHAT_MESSAGES_TAG) as ChatMessages;
  }

  private get lastMessage(): ChatMessage | null {
    const last = this.messages.lastElementChild;
    return last ? (last as ChatMessage) : null;
  }

  private resizeObserver!: ResizeObserver;

  render(): ReturnType<LitElement["render"]> {
    return html``;
  }

  firstUpdated(): void {
    // Don't attach event listeners until child elements are rendered
    if (!this.messages) return;

    this.addEventListener("shiny-chat-input-sent", this.#onInputSent);
    this.addEventListener("shiny-chat-append-message", this.#onAppend);
    this.addEventListener(
      "shiny-chat-append-message-chunk",
      this.#onAppendChunk
    );
    this.addEventListener("shiny-chat-clear-messages", this.#onClear);
    this.addEventListener(
      "shiny-chat-update-user-input",
      this.#onUpdateUserInput
    );
    this.addEventListener(
      "shiny-chat-remove-loading-message",
      this.#onRemoveLoadingMessage
    );
    this.addEventListener("shiny-chat-request-scroll", this.#onRequestScroll);

    this.resizeObserver = new ResizeObserver(() => requestScroll(this, true));
    this.resizeObserver.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    this.removeEventListener("shiny-chat-input-sent", this.#onInputSent);
    this.removeEventListener("shiny-chat-append-message", this.#onAppend);
    this.removeEventListener(
      "shiny-chat-append-message-chunk",
      this.#onAppendChunk
    );
    this.removeEventListener("shiny-chat-clear-messages", this.#onClear);
    this.removeEventListener(
      "shiny-chat-update-user-input",
      this.#onUpdateUserInput
    );
    this.removeEventListener(
      "shiny-chat-remove-loading-message",
      this.#onRemoveLoadingMessage
    );
    this.removeEventListener(
      "shiny-chat-request-scroll",
      this.#onRequestScroll
    );

    this.resizeObserver.disconnect();
  }

  // When user submits input, append it to the chat, and add a loading message
  #onInputSent(event: CustomEvent<Message>): void {
    this.#appendMessage(event.detail);
    this.#addLoadingMessage();
  }

  // Handle an append message event from server
  #onAppend(event: CustomEvent<Message>): void {
    this.#appendMessage(event.detail);
  }

  #appendMessage(message: Message, finalize = true): void {
    this.#removeLoadingMessage();

    const TAG_NAME =
      message.role === "user" ? CHAT_USER_MESSAGE_TAG : CHAT_MESSAGE_TAG;
    const msg = createElement(TAG_NAME, message);
    this.messages.appendChild(msg);

    if (finalize) {
      this.#finalizeMessage();
    }
  }

  // Loading message is just an empty message
  #addLoadingMessage(): void {
    const loading_message = {
      content: "",
      role: "assistant",
    };
    const message = createElement(CHAT_MESSAGE_TAG, loading_message);
    this.messages.appendChild(message);
  }

  #removeLoadingMessage(): void {
    const content = this.lastMessage?.content;
    if (!content) this.lastMessage?.remove();
  }

  #onAppendChunk(event: CustomEvent<Message>): void {
    this.#appendMessageChunk(event.detail);
  }

  #appendMessageChunk(message: Message): void {
    if (message.chunk_type === "message_start") {
      this.#appendMessage(message, false);
    }

    const lastMessage = this.lastMessage;
    if (!lastMessage) throw new Error("No messages found in the chat output");

    if (message.chunk_type === "message_start") {
      lastMessage.setAttribute("streaming", "");
      return;
    }

    lastMessage.setAttribute("content", message.content);

    if (message.chunk_type === "message_end") {
      this.lastMessage?.removeAttribute("streaming");
      this.#finalizeMessage();
    }
  }

  #onClear(): void {
    this.messages.innerHTML = "";
  }

  #onUpdateUserInput(event: CustomEvent<UpdateUserInput>): void {
    const { value, placeholder, attachments } = event.detail;
    if (value !== undefined) {
      this.input.setInputValue({ content: value, attachments });
    }
    if (placeholder !== undefined) {
      this.input.placeholder = placeholder;
    }
  }

  #onRemoveLoadingMessage(): void {
    this.#removeLoadingMessage();
    this.#finalizeMessage();
  }

  #finalizeMessage(): void {
    console.log("message finalized!");
    this.input.disabled = false;
  }

  #onRequestScroll(event: CustomEvent<requestScrollEvent>): void {
    // When streaming or resizing, only scroll if the user near the bottom
    const { cancelIfScrolledUp } = event.detail;
    if (cancelIfScrolledUp) {
      if (this.scrollTop + this.clientHeight < this.scrollHeight - 100) {
        return;
      }
    }

    // Smooth scroll to the bottom if we're not streaming or resizing
    this.scroll({
      top: this.scrollHeight,
      behavior: cancelIfScrolledUp ? "auto" : "smooth",
    });
  }
}

// ------- Register custom elements and shiny bindings ---------

customElements.define(CHAT_MESSAGE_TAG, ChatMessage);
customElements.define(CHAT_USER_MESSAGE_TAG, ChatUserMessage);
customElements.define(CHAT_MESSAGES_TAG, ChatMessages);
customElements.define(CHAT_INPUT_TAG, ChatInput);
customElements.define(CHAT_CONTAINER_TAG, ChatContainer);

$(function () {
  Shiny.addCustomMessageHandler(
    "shinyChatMessage",
    function (message: ShinyChatMessage) {
      const evt = new CustomEvent(message.handler, {
        detail: message.obj,
      });
      const el = document.getElementById(message.id);
      el?.dispatchEvent(evt);
    }
  );
});
