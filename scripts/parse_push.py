# -*- coding: utf-8 -*-
"""用括号配平提取 self.__next_f.push([...]) 的完整 JSON 片段，再做字符串感知还原。
用法：python parse_push.py <html文件> [关键词...]
"""
import json, re, sys


def extract_pushes(html):
    """返回 [(idx, raw_json_string)]，raw_json_string 是 push 的整个数组字面量。"""
    out = []
    for m in re.finditer(r'self\.__next_f\.push\(\[', html):
        start = m.end() - 1  # 指向 '['
        depth, i, in_str, esc = 0, start, False, False
        while i < len(html):
            c = html[i]
            if in_str:
                if esc:
                    esc = False
                elif c == '\\':
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == '[':
                    depth += 1
                elif c == ']':
                    depth -= 1
                    if depth == 0:
                        out.append((start, html[start:i + 1]))
                        break
            i += 1
    return out


def unescape_json_string(s):
    """把 RSC payload 里的 JSON 字符串字面量还原成 Python str（处理 \\uXXXX / \\" 等）。"""
    # s 形如 "...." 且首尾是未转义的引号
    if not (s.startswith('"') and s.endswith('"')):
        return s
    inner = s[1:-1]
    return bytes(inner, 'utf-8').decode('unicode_escape')


def main():
    path = sys.argv[1]
    html = open(path, encoding='utf-8').read()
    pushes = extract_pushes(html)
    print(f"{path}: {len(pushes)} 个 push")

    # 每个 push 的第一个元素通常是 index，第二个是字符串片段（RSC payload）
    texts = []
    for _, raw in pushes:
        # raw 形如 [1,"..."]; 用 json.loads 解析外层数组
        try:
            arr = json.loads(raw)
        except Exception:
            continue
        for el in arr[1:]:
            if isinstance(el, str):
                texts.append(el)
            elif isinstance(el, list):
                for e in el:
                    if isinstance(e, str):
                        texts.append(e)

    blob = "\n".join(texts)
    print(f"拼接文本长度: {len(blob)}")

    keywords = sys.argv[2:] or ['contextWindowTokens']
    for kw in keywords:
        i = blob.find(kw)
        print(f"\n=== {kw!r} at {i}")
        if i < 0:
            continue
        print(blob[max(0, i - 400):i + 700])
        print("----")


if __name__ == "__main__":
    main()