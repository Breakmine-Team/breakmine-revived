// Icons drawn into font.png replace the Latin-1 slots that used to hold
// accented letters (È, Ë, Í, Ó, Ê, ...). Those letters are still real text -
// they are drawn from accented.png - so UI code cannot address an icon by the
// letter that shares its slot; doing so renders the letter instead of the
// icon. Each icon therefore gets a private-use code point as its handle, and
// this table maps that handle to the font.png slot the artwork lives in.
export const FONT_ICONS = {
    0xE100: 0xC8, // half/full food pip pair - full pip
    0xE101: 0xCB, // half pip
    0xE102: 0xCD, // download (export world)
    0xE103: 0xD3, // upload (import world)
    0xE104: 0xCA  // server
};

export const ICON_FOOD_FULL = "\uE100";
export const ICON_FOOD_HALF = "\uE101";
export const ICON_DOWNLOAD = "\uE102";
export const ICON_UPLOAD = "\uE103";
export const ICON_SERVER = "\uE104";
