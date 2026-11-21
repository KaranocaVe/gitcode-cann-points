# GitCode CANN 积分按日汇总

[安装油猴脚本](https://raw.githubusercontent.com/KaranocaVe/gitcode-cann-points/main/gitcode-cann-points.user.js)

装好 Tampermonkey 后打开安装链接。登录 GitCode，在 [CANN 积分商城](https://gitcode.com/setting/points?type=shop&tid=cann) 打开「积分明细」，弹窗自动加载按日汇总。

脚本按页码顺序读取明细，每页请求 100 笔。第一页返回即显示，后续每拿到一页就更新当前汇总。点击某一天可展开各类积分的净变动和笔数。日期按 GitCode 返回的明细日期，类型按积分变动原因归类。读取失败时可从失败页重试。

## 页面未自动替换时

脚本需要先观察到 GitCode 自身发送的 CANN 积分明细请求，以获取当前会话的授权请求头；它不会保存或外传该请求头。v1.1.1 支持页面内跳转、反复打开明细弹窗，以及网页使用 XHR 或 `fetch` 发起明细请求的情形。

如果弹窗仍显示原始明细，请先刷新积分页面并重新打开一次「积分明细」，确保网页正常发出明细请求；再检查 Tampermonkey 是否已启用本脚本。网页若改动了弹窗结构或 API，仍可能需要更新匹配规则。
