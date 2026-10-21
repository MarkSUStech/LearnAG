export const compositionExample = `# 从数据到理解

阅读以文章为主。只有并列关系与参数实验使用布局，普通段落不需要卡片。

<!-- ui:grid columns=2 -->

### 观察分布

拖动 λ，概率、期望和方差均在本地重新计算。

<!-- ui:distribution type=poisson -->

|参数|值|最小|最大|步长|
|---|---|---|---|---|
|lambda|7.5|0|20|0.5|

<!-- ui:cell -->

### 连接概念

<!-- ui:concept -->

|概念|说明|
|---|---|
|期望|平均发生次数 λ|
|方差|对泊松分布也等于 λ|

<!-- ui:popover title="适用条件" -->

在固定区间内，事件独立发生，平均发生速率保持稳定。

<!-- ui:end -->

<!-- ui:end -->

## 逐行理解

<!-- ui:code -->

~~~python
def traverse(node):
    while node is not None:
        print(node.value)
        node = node.next
~~~

|行号|讲解|
|---|---|
|1|接收当前首节点，空链表用 None 表示。|
|2|每次访问前先判空，防止读取不存在的节点。|
|3|读取并输出当前节点保存的值。|
|4|沿 next 前进一格，保证最终到达链尾。|

<!-- ui:steps -->

1. 保存后继：tmp ← p.next

    修改指针前先保留原来的后继，防止丢失后半条链。

2. 接入新节点：p.next ← q

    前驱开始指向新节点，此时还需要完成下一步。

3. 重新接通：q.next ← tmp

    得到 46 → 32 → 51，整个改链过程只需常数次赋值。
`

export const legacyDefectExample = '<!-- ui:sequence mode=static -->\n\n|步骤|说明|\n|---|---|\n|初始：p→(46)，46.next=(51)|在46后插入32|\n|tmp ← p.next|先保存原后继51|\n|p.next ← q|前驱指向新节点32|\n|q.next ← tmp|新节点连接原后继51|\n|结果：46 → 32 → 51|三次指针赋值|'
