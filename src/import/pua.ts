/** 私人造字區（Private Use Area, U+E000～U+F8FF）：學校自訂罕用字，沒有安裝造字檔的電腦會顯示空白或方塊。 */
const PUA_RE = /[-]/;
export const hasPua = (s: string): boolean => PUA_RE.test(s);
/** 「U+E391」格式的碼位，去重、依出現順序 */
export function puaCodes(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    if (!PUA_RE.test(ch)) continue;
    const c = `U+${ch.charCodeAt(0).toString(16).toUpperCase()}`;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
/** 把姓名中的造字區字元換成「〔U+E391〕」，其他字照舊，畫面與警示才看得出差在哪 */
export const showPua = (s: string): string => s.replace(/[-]/g, (c) => `〔U+${c.charCodeAt(0).toString(16).toUpperCase()}〕`);
