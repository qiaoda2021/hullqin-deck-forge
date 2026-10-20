# vendor/ —— 从仓库其他目录拷来的规则引擎

这四个文件不是这个项目写的，是从 `game.hullqin.cn` 反混淆后、由原作者 hullqin
公开在仓库里的实现直接拷贝过来的（1:1，未改一行）。

打包时会按下面的顺序内联进 `dist/*.user.js`，顺序不能换：`dg.ai.js` 在
**加载那一刻**就从 `window` 上取 `DDZEngine` / `GDEngine` / `GDAI`，所以引擎必须先挂好。

| 文件 | 来源 | 挂到 window 的名字 | 进包 |
| --- | --- | --- | --- |
| `ddz.core.js` | `hullqin斗地主/ddz.core.js` | `DDZEngine` | ✅ |
| `gd.core.js` | `hullqin掼蛋/gd.core.js` | `GDEngine` | ✅ |
| `gd.ai.js` | `hullqin掼蛋/gd.ai.js` | `GDAI` | ✅ |
| `gd.site.core.js` | `hullqin掼蛋/油猴版/gd.site.core.js` | `GDSite` | ❌ 只给测试当交叉验证用 |

`gd.site.core.js` 不进包的原因是体积（40KB）——它那份 protobuf 编解码和
`expandState`，`dg.core.js` 里有等价实现，测试里用它来**独立验算**（同一份数据两边
展开出来的手牌必须一致），是测试的对照组，不是运行时依赖。

同步更新这几份的办法：重新从上游拷一次，覆盖同名文件，然后

```bash
node test/dg.core.test.js && node test/dg.ai.test.js && node build.js
```
