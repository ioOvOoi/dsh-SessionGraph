# DSH 官方插件安装/挂载完整链路研究

> 研究日期: 2025-07-16
> 部署版本: `@deepseek-ai/dsh@0.1.0-rc.6`
> 部署根目录: `C:\Users\Administrator\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\`
> Profile 目录: `C:\Users\Administrator\.dsh\profiles\web\`

---

## 1. `dsh plugin` 子命令

### 源码位置
- **命令解析**: `lib/bin.js` 第 96-105 行 (commander `plugin` 子命令)
- **执行逻辑**: `lib/plugin-9h8shc4d.js` (整个文件, 129 行)
- **Profile 初始化**: `@deepseek-ai/dsh-app-boot/lib/index.js` 第 318-566 行

### `--profile` 默认值
**无默认值。`--profile` 是 `plugin` 子命令的 `requiredOption`。**

```javascript
// lib/bin.js 第 96 行
program.command("plugin")
  .requiredOption("--profile <name>", "the profile whose plugins to manage (initialized on first use)")
```

必须显式指定: `dsh plugin --profile web add <spec>`。

### 转发机制
`dsh plugin` **不是**一个包管理器实现——它是一个薄转发层:

1. **初始化**: 如果 profile 目录不存在 `package.json`, 调用 `initProfile(dir, bundles)` 创建模板
2. **转发 pnpm**: 以 `cwd = profile目录` 执行 `pnpm <args>` (通过 `spawnSync`)
3. **调和 bundles**: pnpm 成功后, `reconcilePlugins()` 检查每个 `dependencies`:
   - 读取其 `package.json` 的 `dsh.bundle.patch` 字段
   - 若声明了 `dsh.bundle`, 且尚未在 `dsh.profile.bundles` 中 → 追加到 bundles 列表
   - 若不再声明 `dsh.bundle`(被删除或版本降级) → 从 bundles 中移除

关键代码 (`plugin-9h8shc4d.js` 第 101-127 行):
```javascript
function runPlugin(profile, args) {
    const dir = resolveProfileDir(profile);
    // 初始化(如果需要)
    if (!existsSync(join(dir, "package.json"))) {
        initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES);
    }
    const before = readProfileManifest(NAME, dir);
    // 在 profile 目录执行 pnpm
    const result = spawnSync("pnpm", args.map((argument) => anchorPathSpec(argument, process.cwd())), {
        cwd: dir,
        stdio: "inherit",
        shell: process.platform === "win32"
    });
    // 成功后调和 bundles
    if (exitCode === 0) reconcilePlugins(before, dir);
}
```

### `anchorPathSpec` — 相对路径修正
pnpm 以 `cwd = profile目录` 执行, 因此相对路径 `.` 或 `../plugin` 会在 profile 目录内解析。`anchorPathSpec` 将相对路径锚定到用户调用时的目录:

```javascript
function anchorPathSpec(argument, cwd) {
    const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument);
    if (match?.groups?.path === void 0) return argument;
    return `${match.groups.prefix ?? ""}${resolve(cwd, match.groups.path)}`;
}
```

### spec 支持格式
`dsh plugin --profile web add <spec>` 的 spec 直接传给 pnpm, 因此 **pnpm 支持的所有包说明符格式都可用**:

| 格式 | 示例 | 说明 |
|---|---|---|
| npm 包名 | `@deepseek-ai/cordis-plugin-timer` | 从 registry 安装 |
| npm 包名@版本 | `@deepseek-ai/cordis-plugin-timer@^1.1.3` | 带版本范围 |
| git URL | `git+https://github.com/user/repo.git` | 完整 git URL |
| shorthand | `github:user/repo` | GitHub shorthand |
| 带分支/tag/commit | `git+https://...#v1.0.0` 或 `github:user/repo#main` | 版本锁定 |
| file: | `file:../path/to/plugin` | 本地目录 |
| link: | `link:../path/to/plugin` | 本地符号链接 |
| tarball URL | `https://example.com/pkg.tgz` | tarball URL |

**注意**: `dsh plugin` 还支持 `remove`, `why`, `list` 等所有 pnpm 原生命令。

---

## 2. git URL 安装

### pnpm 支持的 git 依赖格式

pnpm 完整支持:
- `git+https://github.com/user/repo.git`
- `git+ssh://git@github.com/user/repo.git`
- `github:user/repo` (GitHub shorthand)
- 带 `#` fragment 锁定: `git+https://...#v1.0.0`, `#branch-name`, `#commit-sha`

### subdirectory / workspace 子包选择

**pnpm 不直接支持 `#subdir=` 或 workspace 子包选择语法作为 git 依赖的 fragment**。pnpm 的 git 依赖只支持 `#<branch|tag|commit>` 来选择版本, 不能选择仓库内的子目录。

如果插件位于 monorepo 的子目录中, 有以下选项:
1. **推荐**: 从 monorepo 的子目录路径直接发布到 npm, 然后 `dsh plugin add <pkg-name>`
2. **备选**: 如果仓库根是插件包(根 `package.json` 即为插件), 可直接安装
3. **高级**: 使用 `patchedDependencies` 或 workspace 协议(复杂)

### `dsh plugin --profile web add git+https://github.com/ioOvOoi/dsh-SessionGraph.git` 是否可用

**前提条件**: 该仓库的**根 `package.json`** 必须是一个合法的 DSH 插件包:
- 包含 `dsh.client.platform: "web"` 字段(如果有 client 代码)
- `exports["./client"]` 指向构建好的 client bundle
- 包含 `dsh.bundle.patch` 字段(如果是 bundle 类型插件)
- 包含构建好的产物(`lib/client.js` 等)

如果根 `package.json` 满足这些条件, **该命令是可用的**。

### 版本锁定写法

```sh
# 锁定到 tag
dsh plugin --profile web add "git+https://github.com/ioOvOoi/dsh-SessionGraph.git#v1.0.0"

# 锁定到 branch
dsh plugin --profile web add "git+https://github.com/ioOvOoi/dsh-SessionGraph.git#main"

# 锁定到 commit hash
dsh plugin --profile web add "git+https://github.com/ioOvOoi/dsh-SessionGraph.git#a1b2c3d"
```

### Git 插件的 build 问题

源码 `plugin-9h8shc4d.js` 第 124 行有明确提示:
```
git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under allowBuilds in pnpm-workspace.yaml, then re-run
```

即 git 依赖会在安装时执行 `prepare` 脚本构建, 但 pnpm 默认会阻止。需要在 profile 的 `pnpm-workspace.yaml` 中添加:
```yaml
onlyBuiltDependencies:
  - <package-name>  # pnpm 打印的具体 key
```

---

## 3. `cordis.patch.yml` 挂载

### 插件行格式

`cordis.patch.yml` 是一个 **YAML 数组**, 每个元素是一个 patch entry。三种形式:

#### a) `insert` — 追加新行到根 entry list
```yaml
- insert:
    - id: my-plugin
      name: '@scope/my-package'
      config:
        key: value
    - id: another-plugin
      name: '@scope/another-package'
```

#### b) 按 `id` 覆盖已有行的 config/disabled
```yaml
- id: timer
  config:
    interval: 5000

- id: hmr
  disabled: true
```

#### c) 同时 insert 和覆盖(不同 id)
```yaml
# 追加新行
- insert:
    - id: my-plugin
      name: '@scope/my-package'

# 覆盖已有行
- id: timer
  config:
    interval: 5000
```

### `insert` 的两种作用域
- **无 `id` 的 insert**: 追加到根 entry list 末尾
- **带 `id` 的 insert**: 追加到指定 group entry 的子列表

### id 命名约定
从源码观察到的约定(非强制):
- **小写 kebab-case**: `timer`, `hmr`, `web-runtime`, `tool-bash`
- **简短描述性**: 不含包名前缀(如 `web-app`, 不是 `dsh-web-app`)
- **同一包不同配置**: 用 id 区分(如 `tool-subagent` vs `tool-subagent-fork`)

### config 传参示例
```yaml
- insert:
    - id: timer
      name: '@deepseek-ai/cordis-plugin-timer'
      # config 可省略(使用插件默认值)

    - id: session-title
      name: '@deepseek-ai/dsh-session-title'
      config:
        fallbackMaxWords: 5
        fallbackMaxBytes: 40
        maxTitleBytes: 80

    - id: tool-ralph
      name: '@deepseek-ai/dsh-tool-ralph'
      config:
        subagentProvider: spawn
        maxRounds: 64

    # !!js 表达式 —— 引用运行时值
    - id: webserver
      name: '@deepseek-ai/dsh-host-webserver'
      config:
        host: !!js ctx.webStartup.host ?? '127.0.0.1'
        port: !!js ctx.webStartup.port ?? 3080
```

### 添加第三方插件的步骤

**步骤 1**: 通过 `dsh plugin` 安装到 profile:
```sh
dsh plugin --profile web add <package-spec>
```
pnpm 安装后, `reconcilePlugins()` 会检查包的 `dsh.bundle` 声明:
- 有 `dsh.bundle.patch` → 自动加入 `dsh.profile.bundles`
- 无 `dsh.bundle` → 仅作为依赖安装, 不加入 bundles

**步骤 2**: 在 `cordis.patch.yml` 中配置插件行:
```yaml
- insert:
    - id: my-session-graph       # 自定义 id
      name: 'dsh-sessiongraph'   # 包名(必须与 npm/pnpm 解析到的包名一致)
      config:
        someOption: value
```

**步骤 3**: 如果插件有 client 代码, 确保包满足 client bundle 收集条件(见第 4 节)。

**步骤 4**: 重启 dsh (cordis.patch.yml 有热重载, 但 bundle 列表变更需重启)。

### 无官方文档的步骤说明
README.zh.md 只说 "通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件"。具体步骤是通过阅读源码和 cordis.patch.yml 示例文件推断的。`dsh-base/cordis.patch.yml` 和 `dsh-web-app/cordis.patch.yml` 是最佳参考。

---

## 4. Client Bundle 收集机制

### 核心源码
`@deepseek-ai/dsh-client-modules/lib/index.js` — `ClientModuleRegistry` 服务

### 收集机制: **自动扫描 dsh.client 元数据**

**不需要把插件名加进任何列表。** 收集是自动的:

1. **触发时机**: 每次 Cordis Loader 处理 `internal/plugin` 事件(插件 fiber 创建/销毁)
2. **扫描方式**: 遍历 `ctx.loader.entries()` 中所有已加载的 entry
3. **判断条件**: 对每个 entry 的包名, 检查 `package.json` 的 `dsh.client` 字段:
   ```json
   {
     "dsh": {
       "client": {
         "platform": "web",
         "inject": ["dep-a", "dep-b"],  // 可选
         "immediately": true             // 可选
       }
     }
   }
   ```
4. **bundle 路径**: 从 `exports["./client"]` 解析(支持 string 或 `{default: string}` 形式)
5. **graph 生成**: 生成 `window.__DSH_BOOT__` 入口图:
   ```json
   {
     "rev": "sha1-hash",
     "entries": [
       {
         "id": "包名",
         "url": "/plugins/包名/client.js?rev=12字符hash",
         "rev": "12字符hash",
         "inject": ["dep-a"],
         "immediately": true
       }
     ]
   }
   ```
6. **路由注册**: `/plugins/<id>/client.js` 路由自动注册

### 第三方插件要出现在 Client 里需要的条件

插件的 npm 包必须满足:

1. **`package.json` 声明 `dsh.client`**:
   ```json
   {
     "dsh": {
       "client": {
         "platform": "web"    // 必须是 "web"
       }
     }
   }
   ```

2. **`exports["./client"]` 指向构建好的 client bundle**:
   ```json
   {
     "exports": {
       "./client": "./lib/client.js"
     }
   }
   ```

3. **client bundle 使用 `window.__ModuleLoader__.load()` 注册**:
   ```javascript
   window.__ModuleLoader__.load({
     id: "@scope/my-package",
     factory: (require) => {
       var module = { exports: {} };
       var exports = module.exports;
       // ... 插件代码 ...
       return module.exports;
     }
   });
   ```

4. **包在 Loader 的 entry 中被加载** — 通过 cordis.patch.yml 的 insert 行:
   ```yaml
   - insert:
       - id: my-client-plugin
         name: '@scope/my-package'
   ```

### 自动收集的增量特性
- 扫描是**增量的**: 每次 `internal/plugin` 事件只处理变更的 entry
- **元数据缓存**: `dsh.client` 的判断结果按包名缓存, 不会过期
- **bundle 内容变更**: 通过 `rebuilt(id)` 方法触发重新哈希, 不需要重启

### 重要限制
- `package.json` 的 `dsh.client` 必须是 `"platform": "web"` (非 web 的 client 不被收集)
- 如果包声明了 `dsh.client` 但没有 `exports["./client"]`, **构建时会抛错**
- 如果 `exports["./client"]` 指向的文件不存在(未构建), **启动时会抛 MissingClientBundleError**

---

## 5. 验证路径

### 本地测试安装

#### 方法 A: 本地 file: 路径 (推荐测试)
```sh
# 安装(相对路径会被 anchorPathSpec 修正为绝对路径)
dsh plugin --profile web add file:../relative/path/to/plugin

# 或绝对路径
dsh plugin --profile web add file:/absolute/path/to/plugin
```

#### 方法 B: git+file:// (本机 git 仓库)
```sh
dsh plugin --profile web add "git+file:///F:/WorkSpace/dsh-SessionGraph"
```

#### 方法 C: 链接模式 (开发时, 变更即时生效)
```sh
dsh plugin --profile web add link:../relative/path/to/plugin
```
`link:` 创建符号链接而非复制, 修改源码后无需重新安装。

### 验证步骤
1. **安装**: `dsh plugin --profile web add <spec>`
2. **检查 package.json**: 确认 `dependencies` 新增了包, `dsh.profile.bundles` 是否自动加入(有 `dsh.bundle` 时)
3. **检查 cordis.patch.yml**: 确认有 `insert` 行(如果没有 `dsh.bundle`, 需手动加)
4. **启动测试**: `dsh web --dump-default-config` 查看是否出现新行
5. **完整启动**: `dsh web` 查看实际运行

### 卸载
```sh
dsh plugin --profile web remove <package-name>
```
pnpm 会移除依赖, `reconcilePlugins()` 会将其从 `dsh.profile.bundles` 移除。

### cordis.patch.yml 加行后是否需要重启 dsh
- **cordis.patch.yml 本身有热重载** (`watchUserPatches` 函数监控文件变更)
- **但是**: bundle 列表变更(`dsh.profile.bundles`)**需要重启**, 因为它是 `loadProfile` 时读取的
- **实际影响**: 新增插件行到 `cordis.patch.yml` 后, 热重载会尝试加载新插件, 但如果插件尚未在 Loader 的 entry 中(未在 bundles 列表中), 则不会生效
- **建议**: 添加第三方插件后, 重启 dsh 以确保完全加载

---

## 6. 现有 Profile 实际状态

### `package.json` (bundle 列表)
```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app"
      ]
    }
  }
}
```
- **无自定义依赖**: `dependencies` 字段不存在(未安装任何第三方插件)
- **标准 web profile 模板**: 与 `PROFILE_TEMPLATES.web` 一致

### `cordis.patch.yml`
```yaml
[]
```
空数组 — 用户未添加任何自定义 patch 层。

### `cordis.yml`
```yaml
[]
```
空根配置 — 所有内容通过 patch 层叠加。

### `pnpm-workspace.yaml`
```yaml
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
```
标准 profile workspace 配置。

### `pnpm-lock.yaml`
```yaml
lockfileVersion: '9.0'
settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false
importers:
  .: {}
```
空 lockfile — 无任何安装的依赖。

### Profile 目录结构
```
~/.dsh/profiles/web/
├── cordis.patch.yml        # 用户 patch 层 (空)
├── cordis.yml              # 空根配置
├── package.json            # profile manifest
├── pnpm-lock.yaml          # 空 lockfile
├── pnpm-workspace.yaml     # workspace 配置
└── node_modules/
    ├── .modules.yaml
    ├── .package-map.json
    └── .pnpm-workspace-state-v1.json
```
无 `node_modules` 下的实际包安装 — 完全依赖 `$DSH_HOME/profiles/node_modules` 的 symlink fallback 机制(由 `healProfilesModuleFallback` 维护, 链接到 DSH 安装目录的依赖闭包)。

### `$DSH_HOME/profiles/node_modules` (symlink fallback)
未创建此目录 — 因为 `healProfilesModuleFallback` 只在启动时 (`prepareProfile`) 调用。

---

## 7. 总结

### 安装命令确认

```sh
# npm 包
dsh plugin --profile web add <package-name>
dsh plugin --profile web add <package-name>@<version>

# git URL (完整)
dsh plugin --profile web add git+https://github.com/user/repo.git

# git URL + 版本锁定
dsh plugin --profile web add "git+https://github.com/user/repo.git#v1.0.0"
dsh plugin --profile web add "git+https://github.com/user/repo.git#commit-sha"

# GitHub shorthand
dsh plugin --profile web add github:user/repo

# 本地路径
dsh plugin --profile web add file:../path/to/plugin
dsh plugin --profile web add link:../path/to/plugin  # 开发用

# 卸载
dsh plugin --profile web remove <package-name>
```

### 挂载步骤清单

1. **安装插件**: `dsh plugin --profile web add <spec>`
2. **确认安装**: 检查 `~/.dsh/profiles/web/package.json` 的 `dependencies` 和 `dsh.profile.bundles`
3. **配置插件**: 编辑 `~/.dsh/profiles/web/cordis.patch.yml` 添加 `insert` 行:
   ```yaml
   - insert:
       - id: my-plugin-id
         name: '<package-name>'
         config:
           key: value
   ```
4. **处理 build**: 如果是 git 依赖且有 `prepare` 脚本, 在 `pnpm-workspace.yaml` 中添加:
   ```yaml
   onlyBuiltDependencies:
     - <package-name>
   ```
5. **重启 dsh**: `dsh web` (bundle 列表变更需要重启)

### Client Bundle 收集机制结论

**自动收集, 无需额外步骤。** `@deepseek-ai/dsh-client-modules` 的 `ClientModuleRegistry` 服务自动扫描 Loader 中所有 entry 的 `dsh.client` 元数据。第三方插件只需:

1. `package.json` 声明 `dsh.client.platform: "web"`
2. `exports["./client"]` 指向构建好的 client bundle
3. client bundle 使用 `window.__ModuleLoader__.load()` 注册
4. 在 `cordis.patch.yml` 中通过 `insert` 行添加到 Loader

### 本地验证路径建议

1. **快速验证**: `file:../path` 或 `link:../path` 安装, 然后 `dsh web --dump-default-config` 检查
2. **完整验证**: `dsh web` 启动, 浏览器检查 `/plugins/<id>/client.js` 是否可访问
3. **卸载清理**: `dsh plugin --profile web remove <name>`, 然后清理 `cordis.patch.yml`
4. **热重载测试**: 修改 `cordis.patch.yml` 后观察是否自动加载(非 bundle 变更的行)
