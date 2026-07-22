import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import Button from "./Button.svelte";

describe("Button", () => {
  it("renders the primary variant and forwards clicks", async () => {
    const onclick = vi.fn();
    const { getByRole } = render(Button, {
      props: { variant: "primary", onclick },
    });
    const button = getByRole("button");

    expect(button).toHaveClass("bg-primary");
    await fireEvent.click(button);
    expect(onclick).toHaveBeenCalledTimes(1);
  });

  it("prevents interaction when disabled", () => {
    const onclick = vi.fn();
    const { getByRole } = render(Button, {
      props: { disabled: true, onclick },
    });
    expect(getByRole("button")).toBeDisabled();
  });
});
