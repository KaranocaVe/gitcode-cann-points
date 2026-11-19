# GitCode CANN 积分按日汇总

[安装油猴脚本](https://raw.githubusercontent.com/KaranocaVe/gitcode-cann-points/main/gitcode-cann-points.user.js)

装好 Tampermonkey 后打开安装链接。登录 GitCode，在 [CANN 积分商城](https://gitcode.com/setting/points?type=shop&tid=cann) 打开「积分明细」，弹窗自动加载按日汇总。

脚本按页码顺序读取明细，每页请求 100 笔。第一页返回即显示，后续每拿到一页就更新当前汇总。点击某一天可展开各类积分的净变动和笔数。日期按 GitCode 返回的明细日期，类型按积分变动原因归类。读取失败时可从失败页重试。
