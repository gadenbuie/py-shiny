import json

from shiny import App, ui

app_ui = ui.page_fillable(
    ui.panel_title("Hello Shiny Chat"),
    ui.chat_ui("chat"),
    ui.input_dark_mode(style="display: none"),
    fillable_mobile=True,
)

# Create a welcome message
welcome = ui.markdown(
    """
    Hi! This is a simple Shiny `Chat` UI. Enter a message below and I will
    simply repeat it back to you. For more examples, see this
    [folder of examples](https://github.com/posit-dev/py-shiny/tree/main/examples/chat).
    """
)

# TODO: remove from example app (this is demo code)
def user_input_dict(x: str):
    if not x:
        return {"content": "", "attachments": []}
    if x[:1] == "{":
        return json.loads(x)
    else:
        return {"content": x, "attachments": []}


def server(input, output, session):
    chat = ui.Chat(id="chat", messages=[welcome])

    # Define a callback to run when the user submits a message
    @chat.on_user_submit
    async def _():
        # Get the user's input
        user = user_input_dict(chat.user_input())
        txt_attachments = ""
        if (n_attached := len(user["attachments"])):
            txt_attachments = "attachments" if n_attached != 1 else "attachment"
            txt_attachments = f" (with {n_attached} {txt_attachments})" if n_attached > 0 else ""
        echo = f'You said{txt_attachments}:\n\n{user["content"]}'
        await chat.append_message({
            "role": "assistant",
            "content": echo,
            "content_type": "html"
        })

app = App(app_ui, server)
