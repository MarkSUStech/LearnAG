import { componentGuide } from '../../shared/noteuiRegistry.js'

// Same schema as parser and Gallery; no extra AI request.
export const NOTEUI_PROMPT = `
## NoteUI（默认启用）
学习讲解、算法题答疑中对比/定义/步骤/练习必须添加对应指令。短答不凑组件，指定格式优先，不编数据、不重复原表。长文用Markdown；并列信息才用row/grid；仅独立摘要用card，勿嵌套卡片或把全文装进卡片。间距默认由容器决定，gap仅inner/group/section。输入必须实际改变本地结果；新请求才用已有Agent/ask_user，不增加格式修复调用。
独立一行 <!-- ui:组件 参数=值 -->，空行后接数据；勿放围栏/引用/列表。仅下列参数和通用title="标题"，禁止JS/HTML/CSS。除布局外表格须有表头、分隔行，列按以下顺序；chart/graph用精确列名。双链[[目标|显示名]]勿转义。公式同一对$内完整闭合，勿用反引号；表格公式用\\lvert/\\rvert、\\lVert/\\rVert、\\mid避免分列。
${componentGuide()}
row/col/box/grid/card/carousel/popover是成对容器：正文或NoteUI后以 <!-- ui:end --> 闭合；并列格用 <!-- ui:cell --> 分隔，最多4层、每层12格。divider/spacer无需end。普通文字、图像仍用Markdown；机制/流程图用graph/Mermaid，空间关系用geometry。仅交互有帮助时使用控件。
现成控件难以表达的指针、机制或空间示意优先svg：只画核心关系，短标签、留足间距，箭头避开节点；自己检查坐标，不假设自动布局。禁输出原始SVG，公式放相邻Markdown。
输出示例（勿包围栏）：
<!-- ui:compare -->

|类型|适用场景|
|---|---|
|离散|合并同值概率|
|连续|CDF或密度变换|

SVG示例：
<!-- ui:svg width=400 height=160 title="节点连接" -->

|形状|位置|尺寸或终点|文字|颜色|
|---|---|---|---|---|
|rect|20,50|100,50|head|accent|
|rect|250,50|100,50|next|blue|
|arrow|120,75|242,75|指向后继|ink|

算法流程用steps、证明用derivation、代码用code、数组用sequence/playback、DP用matrix、自测用quiz，按内容选择。保留原指令/数据，交互仅当前会话。未知/无效块回退Markdown；不生成任意代码执行器。
`
