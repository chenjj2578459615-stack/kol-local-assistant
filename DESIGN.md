---
name: KOL 本地助手
description: 浅灰白、石墨色胶囊控件的操作台
colors:
  background: "#f5f5f7"
  surface: "#ffffff"
  text: "#27282b"
  muted: "#696a70"
  secondary: "#eeeef2"
  graphite: "#303133"
  success: "#398168"
  keyword-hit: "#9b4c4c"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: "27px"
    fontWeight: 650
    letterSpacing: "-0.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif'
    fontSize: "14px"
    fontWeight: 400
  size-10:
    fontSize: "10px"
  size-11:
    fontSize: "11px"
  size-12:
    fontSize: "12px"
  size-13:
    fontSize: "13px"
  size-15:
    fontSize: "15px"
  size-16:
    fontSize: "16px"
  size-17:
    fontSize: "17px"
  size-18:
    fontSize: "18px"
  size-20:
    fontSize: "20px"
  size-23:
    fontSize: "23px"
  size-25:
    fontSize: "25px"
rounded:
  card: "26px"
  input: "13px"
  capsule: "999px"
  compact-card: "23px"
  logo: "12px"
  compact-logo: "11px"
  input-pair: "14px"
  micro-button: "30px"
  circle: "50%"
spacing:
  group: "10px"
  section: "22px"
  card: "26px"
components:
  button-primary:
    backgroundColor: "{colors.graphite}"
    textColor: "{colors.surface}"
    rounded: "{rounded.capsule}"
    padding: "10px 19px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.text}"
    rounded: "{rounded.capsule}"
---

# Design System: KOL 本地助手

## Overview

依据用户2026-11-23的DayMark参考截图及明确要求，采用苹果系的简约轻拟物。浅灰白背景、纯白大圆角卡片、石墨黑灰渐变的主按钮与导航选中态。模式为Operate，操作清晰优先，颜色主要用于读取状态与品牌关键词。

## Colors

页面底色与卡片用灰白层次区分。主文字石墨灰，辅助文字中性灰。品牌关键词命中使用淡红底、深红字与叉号，完整检索无命中使用淡绿底、深绿字与勾号；未设置、待确认使用淡灰底与深灰字，暂停及读取异常使用淡暖色底与深色字。用户要求已合作/未合作作为界面标签，点击展示实际关键词视频证据。

## Typography

使用系统无衬线字体。页标题27px，低高度桌面25px；卡片标题18px，正文14px，控件和表格11–13px。数字使用tabular-nums，不在粉丝量显示格式中改写底层精确人数。

## Layout

顶部三列布局使“操作台/历史记录”胶囊Tab相对视口居中，品牌左对齐，连接/版本/帮助/更新右对齐。桌面主区左右布局：达人输入区自适应，任务设置和连接平台固定340px。桌面主体固定视口，输入行和结果表各自局部滚动，不为右侧设置增加滚动条。已验证1440×900、1366×768、1280×720、1024×768及1280×600一屏布局。

结果页标题行保留开始下一批、调整列、复制。表格工具栏平静展示“播放量统计：近N天/最近N条视频”，不使用黄色提醒或步骤条。表格末两列为品牌关键词、读取状态，桌面固定在右侧，始终独立于12个复制字段。低于980px改为自然纵向布局，顶部固定；小屏只固定读取状态列，避免占满视口。

## Elevation & Depth

卡片无描边，使用0 8px 30px #24252a04与0 2px 6px #24252a02柔和阴影。主按钮和选中Tab为linear-gradient(180deg,#494a4b 0%,#303133 48%,#242527 100%)，顶部内高光及下方轻阴影；其余控件浅灰底。渐变仅用于用户明确要求的控件材质，不用于文字或整页装饰。

## Shapes

卡片26px、输入框13px、按钮和状态胶囊999px。关闭、删除、移动为简洁线性图标。TikTok、Instagram和YouTube使用本地正式品牌轮廓，来源记录在extension/assets/SOURCES.md。

## Components

- 范围设置：直接编辑数值和“天/条视频”单位，下面的最近5条/10条/14天/30天只负责快捷填入，不使用选中交互。
- 品牌关键词：已合作为叉号、未合作为勾号；不完整无命中为待确认，没填关键词为未设置。点击用弹窗显示命中视频和检索状态。
- 读取状态：每行显示状态与“查看”；弹窗呈现原因、已读数量、样本数及统计范围，可进入既有达人详情或复制诊断。
- 数据表：12个业务列支持原有排序、显隐与复制；末两列仅用于界面，不存入result、不加入列配置和复制。历史使用同一展示组件但数据只读。
- 粉丝量：TikTok和Instagram均显示3.88k、7.7M，悬停及详情保留精确人数。
- 操作说明放帮助页，主界面删除顶部黄色提醒、123步骤、播放范围黄色说明、结果标题下说明和表格底说明。删除“打开采集页”和“修改输入”。登录授权所需的真实异常原因仍可查看。

## Do's and Don'ts

不增加未实现的平台入口，不嵌入平台浏览器；已实现TikTok采集及Instagram、YouTube可选补充。不得把未完成检索标成未合作，不把界面元信息混进导出。支持键盘焦点、禁用、空状态、等待与错误状态；减少动态装饰。

0.1.16增补：表头浅灰加深并提高字重、字号，正文链接使用#2464b3。右侧元信息区底色#f8f9fb，品牌列左侧1px分隔#d5d8e0；品牌/读取状态统一为实色底白字胶囊标签（绿#16834b、红#d93645、深灰#595d66，白字对比度均至少4.5:1），“查看”使用白底圆角按钮。链接不作为业务列，详情才显示。单行重读有行内加载状态，保持原批次和结果页；性别未知直接留白。Instagram读取状态仅在详情中独立展示，不将未授权或未读IG作为TikTok失败原因。

0.1.17增补：按用户最新反馈恢复淡色状态标签。品牌红#f7e9e9/#934444、绿#e7f1eb/#2b6b51；中性#e9ecf2/#555c69；异常及暂停#f2ece5/#805b3d。查看弹窗同步采用淡色标签，状态区分隔与查看按钮保留。

0.1.18增补：连接平台增加与TikTok/Instagram一致的灰底、黑色正式YouTube轮廓图标、独立状态和单一动作按钮。表格增加YouTube订阅数，默认紧跟IG粉丝量，可调列和复制；未知留空。详情允许填写频道链接并读取订阅数，不新增来源标签。第三个平台加入后仍保持桌面600px高度的一屏布局。

0.1.19增补：达人类型改为当前播放统计范围内的本地规则分类。解析链路分别保存真实 hashtag、视频描述和主页简介；hashtag 权重最高，描述其次，简介仅作辅助。至少命中 3 条视频或达到 15% 覆盖率才输出，最多输出两个主类型；tutorial、challenge、POV、funny 等视频形式词不会单独生成达人类型。


0.2.0（2026-11-25）：按最新需求新增三平台搜索图标Tab，替换达人采集与历史记录页面标题；操作台/历史记录导航保留，历史按主平台过滤。TikTok、Instagram、YouTube可分别创建批次，输入/字段随平台变化。YouTube普通视频+Shorts，不含直播；IG图片不计视频均值。补充其他两平台的明确主页URL，按平台显示14个可配置业务列（全局16个键，排除本平台补充列），末尾两列仍仅用于查看。列拖动支持requestAnimationFrame边缘持续滚动。任务设置增加可选AI入口，默认关闭；用户自填OpenAI兼容HTTPS接口、模型及Key。仅发简介与范围内文本抽样，用户可勾选最多6张多视频封面/缩略图共同判断类型，不发录入的联系方式，不根据姓名/头像/视频人物推断性别。AI自述摘句还需本地复核；人工修改优先。密钥独立存储，不进批次与分发包。界面保持现有灰白石墨风格。实测YouTube公开读取通过，Instagram匿名环境要求登录；见docs/0.2.0多平台与AI辅助说明.md，不将模拟站点成功描述为真实IG验收。

用户随后指定 $graphite-white-ui：新增组件采用22px白色圆角面板、#232323正文、#5c5c5c辅助文字，主按钮/选中Tab/开启态开关共用双层石墨光泽。列拖动实时补位340ms，取消恢复原顺序，自动滚动独立驱动。多模态AI仅用当前范围内最多6张主页视频封面/缩略图+文本判断类型，图片不用于性别，支持纯文字关闭图片。


0.2.1（2026-11-26）：用户要求所有GitHub发布先给出更新说明并等待明确同意，且发布为正式Release。右上角帮助与检查更新合并为版本更新；弹窗呈现当前版本、更新内容、GitHub正式版检测、立即更新、下次再说、自动提醒开关，使用说明移入弹窗。每6小时检测，延后24小时。Windows由首次安装时配置的按需Chrome Native Messaging组件下载校验并写入独立版本目录，插件保存数据后重载；无桌面操作台、常驻服务或平台页面刷新。旧版用户首次运行一次本版安装文件，后续全部在插件内完成。实际公开发布须在本次更新内容获批后进行。
