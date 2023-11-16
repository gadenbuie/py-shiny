import matplotlib.pyplot as plt
import numpy as np

from shiny import render, ui
from shiny.express import input, layout

with layout.accordion(open=["Panel 1", "Panel 2"]):
    with layout.accordion_panel("Panel 1"):
        ui.input_slider("n", "N", 1, 100, 50)

    with layout.accordion_panel("Panel 2"):

        @render.text
        def txt():
            return f"n = {input.n()}"


@render.plot
def histogram():
    np.random.seed(19680801)
    x = 100 + 15 * np.random.randn(437)
    plt.hist(x, input.n(), density=True)