export type InkLikeKey = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  home: boolean;
  end: boolean;
};

type NodeKey = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
} | undefined;

export function shim(str: string | undefined, k: NodeKey): { value: string; key: InkLikeKey } {
  const name = k?.name ?? "";
  const key: InkLikeKey = {
    upArrow: name === "up",
    downArrow: name === "down",
    leftArrow: name === "left",
    rightArrow: name === "right",
    pageUp: name === "pageup",
    pageDown: name === "pagedown",
    return: name === "return" || name === "enter",
    escape: name === "escape",
    ctrl: Boolean(k?.ctrl),
    shift: Boolean(k?.shift),
    meta: Boolean(k?.meta),
    tab: name === "tab",
    backspace: name === "backspace",
    delete: name === "delete",
    home: name === "home",
    end: name === "end"
  };

  let value = str ?? "";
  if (k?.ctrl && !value && name && name.length === 1) {
    value = name;
  }

  const named =
    key.return ||
    key.escape ||
    key.tab ||
    key.backspace ||
    key.delete ||
    key.upArrow ||
    key.downArrow ||
    key.leftArrow ||
    key.rightArrow ||
    key.pageUp ||
    key.pageDown ||
    key.home ||
    key.end;

  if (named && !k?.ctrl) {
    value = "";
  }

  return { value, key };
}
