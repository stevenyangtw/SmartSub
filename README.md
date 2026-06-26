# 🚀 妙幕 / SmartSub

<div align="center">

<a href="https://trendshift.io/repositories/14079?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-14079" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/14079" alt="buxuku%2FSmartSub | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/14079?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-14079" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/14079/daily?language=TypeScript" alt="buxuku%2FSmartSub | Trendshift" width="250" height="55"/></a>

<!-- 第一行：核心狀態 - CI/版本/許可證/平臺 -->

[![Build Status](https://img.shields.io/github/actions/workflow/status/buxuku/SmartSub/release.yml?style=flat-square&logo=githubactions&logoColor=white&label=Build)](https://github.com/buxuku/SmartSub/actions/workflows/release.yml)
[![Release](https://img.shields.io/github/v/release/buxuku/SmartSub?style=flat-square&logo=github&color=blue&label=Release)](https://github.com/buxuku/SmartSub/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square&logo=opensourceinitiative&logoColor=white)](https://github.com/buxuku/SmartSub/blob/master/LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square&logo=electron&logoColor=white)](https://github.com/buxuku/SmartSub/releases)
[![i18n](https://img.shields.io/badge/i18n-中文%20%7C%20English%20%7C%20日本語-orange?style=flat-square&logo=googletranslate&logoColor=white)](https://github.com/buxuku/SmartSub)

<!-- 第二行：功能特性 - 引擎/翻譯服務/硬件加速 -->

[![ASR Engines](https://img.shields.io/badge/ASR-6%20Engines-4B8BBE?style=flat-square&logo=openai&logoColor=white)](https://github.com/buxuku/SmartSub#-轉寫引擎)
[![Translation](https://img.shields.io/badge/Translation-17%20Services-9cf?style=flat-square&logo=translate&logoColor=white)](https://github.com/buxuku/SmartSub#翻譯服務)
[![CUDA](https://img.shields.io/badge/CUDA-11.8%20%7C%2012.x%20%7C%2013.x-76B900?style=flat-square&logo=nvidia&logoColor=white)](https://developer.nvidia.com/cuda-downloads)
[![Vulkan](https://img.shields.io/badge/Vulkan-AMD%20%7C%20Intel-AC162C?style=flat-square&logo=vulkan&logoColor=white)](https://www.vulkan.org/)
[![CoreML](https://img.shields.io/badge/Core%20ML-Apple%20Silicon-000000?style=flat-square&logo=apple&logoColor=white)](https://developer.apple.com/documentation/coreml)

<!-- 第三行：技術棧 -->

[![Electron](https://img.shields.io/badge/Electron-30-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

<!-- 第四行：社區指標 -->

[![Downloads](https://img.shields.io/github/downloads/buxuku/SmartSub/total?style=flat-square&logo=github&label=Downloads&color=brightgreen)](https://github.com/buxuku/SmartSub/releases)
[![Stars](https://img.shields.io/github/stars/buxuku/SmartSub?style=flat-square&logo=github&label=Stars)](https://github.com/buxuku/SmartSub/stargazers)
[![Forks](https://img.shields.io/github/forks/buxuku/SmartSub?style=flat-square&logo=github&label=Forks)](https://github.com/buxuku/SmartSub/network/members)
[![Issues](https://img.shields.io/github/issues/buxuku/SmartSub?style=flat-square&logo=github&label=Issues)](https://github.com/buxuku/SmartSub/issues)
[![Last Commit](https://img.shields.io/github/last-commit/buxuku/SmartSub?style=flat-square&logo=github&label=Last%20Commit)](https://github.com/buxuku/SmartSub/commits)

<br/>

[ 🇨🇳 中文](README.md) | [ 🌏 English](README_EN.md) | [ 🇯🇵 日本語](README_JA.md)

</div>

**讓每一幀畫面都能美妙地表達**

妙幕（SmartSub）是一款本地優先的桌面應用，幫你**一站式**完成「音影片轉字幕 → 翻譯 → 校對 → 合成」。所有轉寫都在本地完成，無需上傳文件，隱私無憂；支持批量處理與 GPU 加速，可在 Windows / macOS / Linux 上運行。

![preview](./resources/preview/home.png)

## ✨ 3.0 重磅更新

3.0 是一次幾乎重寫的大版本，核心變化如下：

- **🧠 多轉寫引擎**：從單一 whisper.cpp 擴展到 **6 種可逐任務切換的引擎**——內置 `whisper.cpp`、`faster-whisper`、`FunASR`、`Qwen3-ASR`、`FireRedASR`、以及本地 `Whisper CLI`。中文場景可直接選用 FunASR / FireRedASR 等專長模型。
- **⚡ GPU 加速全面重構**：新增 **Vulkan** 後端，**AMD / Intel 顯卡**也能在 Windows/Linux 上加速（此前僅支持 NVIDIA CUDA）；新增「自動 / 僅 GPU / 僅 CPU」加速模式，自動識別顯卡、按需下載加速包、失敗自動回退到 CPU。
- **🎬 影片合成（字幕燒錄）**：把字幕**硬燒**進畫面，或**軟封裝**為可切換字幕軌；所見即所得預覽，支持字體、字號、顏色、描邊、陰影、九宮格位置與多種預設樣式。
- **📝 字幕校對 + AI 潤色**：內置校對臺，逐句對照影片檢查修改，支持撤銷/重做與 AI 一鍵潤色。
- **🌐 17 個翻譯服務**：覆蓋主流機器翻譯與大模型 API，並支持 OpenAI 風格自定義接入與逐服務的自定義參數。
- **🖥️ 全新任務式界面**：以「您想做什麼？」為起點的啟動臺，任務、字幕校對、影片合成、引擎與模型、翻譯服務分區清晰；內置新手引導、命令面板（⌘K / Ctrl+K）、快捷鍵與下載/任務活動中心。

## 💥 功能特性

### 🧠 字幕生成（轉寫）

- 支持多種影片/音頻格式批量生成字幕
- **6 種轉寫引擎**，可針對每個任務單獨選擇（詳見 [轉寫引擎](#-轉寫引擎)）
- 完全本地處理，無需聯網上傳，保護隱私的同時擁有更快的速度
- 支持簡繁轉換、自定義字幕文件名（方便不同播放器掛載識別）
- 可選**中文字幕去標點**，讓燒錄效果更乾淨
- 支持自定義併發任務數量，批量處理更高效

### 🌐 字幕翻譯

- 對生成的字幕或導入的字幕進行翻譯
- **17 個翻譯服務**：百度、谷歌、阿里雲、火山引擎、豆包、小牛、騰訊、訊飛、DeepLX、Azure、Ollama（本地模型）、DeepSeek、Azure OpenAI、[DeerAPI](https://api.deerapi.com/register?aff=QvHM)、Gemini、SiliconFlow、通義千問
- 兼容任意 **OpenAI 風格 API**，可接入 deepseek / azure 等自有服務
- 輸出內容可選純譯文，或「原文 + 譯文」雙語字幕
- **🎯 自定義參數配置**：無需改代碼，直接在界面為每個 AI 服務配置請求頭/請求體參數，並支持導出導入

### 📝 字幕校對

- 內置校對臺，逐句檢查與修改
- 影片對照預覽，定位更準
- 支持撤銷/重做與 **AI 一鍵潤色**

### 🎬 影片合成

- **硬字幕燒錄**：把字幕永久燒進畫面，任何播放器都能顯示
- **軟字幕封裝**：以流複製方式無損嵌入可切換字幕軌
- 豐富的樣式控制：字體、字號、顏色、描邊、陰影、九宮格位置，以及多種預設樣式
- 所見即所得實時預覽

### ⚡ 隱私與加速

- 本地化處理，文件不出本機
- GPU 加速：NVIDIA CUDA、AMD/Intel Vulkan、Apple Core ML / Metal（詳見 [GPU 加速](#-gpu-加速)）
- 內置加速包管理，無需手動安裝 CUDA Toolkit

## 📸 界面一覽

| 影片合成（字幕燒錄）                    | 字幕校對                                       |
| --------------------------------------- | ---------------------------------------------- |
| ![merge](./resources/preview/merge.png) | ![proofread](./resources/preview/profread.png) |

## 🧩 轉寫引擎

3.0 把「轉寫引擎」做成了可逐任務切換的能力，可在「引擎與模型」頁面統一管理運行時與模型：

| 引擎                    | 說明                                                           | 運行方式                           |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------- |
| **whisper.cpp（內置）** | 預設引擎，支持 ggml 量化模型與 GPU 加速                        | 隨應用內置，開箱即用               |
| **faster-whisper**      | 基於 CTranslate2，速度更快，模型按需從 HuggingFace 下載        | 自包含 Python 運行時（應用內下載） |
| **FunASR**              | SenseVoice（中/英/日/韓/粵多語）與 Paraformer-zh，中文表現優秀 | 內置 sherpa-onnx 原生庫            |
| **Qwen3-ASR**           | 通義千問語音識別（qwen3-asr-0.6b）                             | 內置 sherpa-onnx 原生庫            |
| **FireRedASR**          | FireRedASR-AED large（中英），中文表現優秀                     | 內置 sherpa-onnx 原生庫            |
| **本地 Whisper CLI**    | 調用你自行安裝的 whisper 兼容命令                              | 使用系統已裝命令                   |

> 提示：FunASR / Qwen3-ASR / FireRedASR 均通過內置的 sherpa-onnx 原生庫運行，無需額外環境；faster-whisper 會在應用內下載一個自包含運行時。

### whisper 模型怎麼選？

whisper.cpp / faster-whisper 使用的是 whisper 系列模型，模型越大越準、越慢、越吃顯存：

- 低端設備或核顯：推薦 `tiny` / `base`，速度快、佔用小
- 普通電腦：從 `small` / `base` 起步，平衡精度與資源
- 高性能顯卡/工作站：推薦 `large` 系列，精度最高
- 純英文音影片：選帶 `en` 的模型，專為英語優化
- 在意體積：可用 `q5` / `q8` 量化版本，犧牲少量精度換取更小體積

## ⚡ GPU 加速

軟體內置 GPU 加速包管理，**無須手動安裝 CUDA Toolkit**。安裝後進入「設置 → GPU 加速」，軟體會自動檢測顯卡並推薦合適的加速方案。

| 平臺                          | 加速後端            | 說明                                                              |
| ----------------------------- | ------------------- | ----------------------------------------------------------------- |
| Windows / Linux + NVIDIA      | **CUDA**            | 支持 CUDA 11.8.0 / 12.2.0 / 12.4.0 / 13.0.2，應用內下載對應加速包 |
| Windows / Linux + AMD / Intel | **Vulkan**          | 3.0 新增，應用已內置 Vulkan 加速包                                |
| macOS（Apple 芯片）           | **Core ML / Metal** | 下載 mac arm64 版本後自動啟用                                     |
| 任意平臺                      | **CPU**             | 無可用 GPU 時自動回退                                             |

- 加速模式支持「**自動 / 僅 GPU / 僅 CPU**」，加載失敗會自動降級到 CPU，並在診斷面板給出原因
- 如啟用加速後出現閃退，可嘗試切換其它版本的加速包，或切換為「僅 CPU」模式

## 翻譯服務

本項目支持百度、火山引擎、阿里雲、騰訊、訊飛、小牛、谷歌、DeepLX，以及 Ollama、DeepSeek、Gemini、通義千問、SiliconFlow、Azure OpenAI、DeerAPI 等大模型/聚合平臺，共 17 個翻譯服務。使用這些服務需要相應的 API 密鑰或配置。

對於百度翻譯、火山引擎等服務的 API 申請方法，可以參考 https://bobtranslate.com/service/ ，感謝 [Bob](https://bobtranslate.com/) 這款優秀的軟體提供的信息。

對於 AI 翻譯，翻譯結果受模型和提示詞的影響比較大，你可以嘗試不同的模型和提示詞，找到適合自己的組合。

### 自定義參數配置

SmartSub 支持為每個 AI 翻譯服務配置自定義參數，讓你精確控制模型行為：

- **靈活配置**：直接在界面添加和管理自定義參數，無需修改代碼
- **類型支持**：String、Float、Boolean、Array、Object、Integer
- **實時驗證**：參數修改時實時校驗，防止無效配置
- **導入導出**：方便團隊共享和備份
- **自動保存**：沿用系統設計，任何修改自動保存

## 🔦 使用（普通用戶）

請根據自己的電腦系統和芯片，選擇下載對應安裝包。GPU 加速包無須在下載時選擇，安裝軟體後可在應用內下載。

| 系統    | 芯片  | 下載安裝包  | 說明                                            |
| ------- | ----- | ----------- | ----------------------------------------------- |
| Windows | x64   | windows-x64 | NVIDIA 用 CUDA，AMD/Intel 用 Vulkan，應用內下載 |
| Mac     | Apple | mac-arm64   | 自動啟用 Core ML / Metal 加速                   |
| Mac     | Intel | mac-x64     | 僅 CPU，不支持 GPU 加速                         |
| Linux   | x64   | linux-x64   | NVIDIA 用 CUDA，AMD/Intel 用 Vulkan，應用內下載 |

### macOS 用戶通過 Homebrew 安裝（推薦）

macOS 用戶可以通過 Homebrew 快速安裝，會自動根據芯片類型（Intel/Apple Silicon）下載對應版本：

```bash
# 添加 tap（只需執行一次）
brew tap buxuku/tap

# 安裝
brew install --cask smartsub
```

升級和卸載：

```bash
# 升級到最新版本
brew upgrade --cask smartsub

# 卸載
brew uninstall --cask smartsub
```

### 手動下載安裝

1. 前往 [release](https://github.com/buxuku/SmartSub/releases) 頁面根據自己的操作系統下載安裝包
2. 或者使用網盤 [夸克](https://pan.quark.cn/s/0b16479b40ca) 選擇對應的版本進行下載
3. 安裝並運行程序
4. 跟隨新手引導，下載一個語音模型
5. 在「翻譯服務」中配置所需的翻譯服務（可選）
6. 在啟動臺選擇任務，拖入音影片或字幕文件
7. 設置相關參數（源語言、目標語言、引擎、模型等）
8. 開始處理任務

## 🔦 使用（開發用戶）

1️⃣ 克隆本項目在本地

```shell
git clone https://github.com/buxuku/SmartSub.git
```

2️⃣ 在項目中執行 `yarn install` 或者 `npm install`

```shell
cd SmartSub
yarn install
yarn sherpa:fetch # 下載 sherpa-onnx 原生庫
```

如果是 windows / linux 平臺，或者 Mac intel 平臺，請前往 https://github.com/buxuku/whisper.cpp/releases/tag/latest 下載對應的 node 文件，並重命名為 `addon.node` , 覆蓋放在 `extraResources/addons/` 目錄下。

3️⃣ 依賴包安裝好之後，執行 `yarn dev` 或者 `npm run dev` 啟動項目

```shell
yarn dev
```

## 手動下載和導入模型

因為模型文件比較大，如果通過該軟體下載模型會存在難以下載的情況，可以手動下載模型並導入到應用中。以下是兩個可用於下載 whisper 模型的鏈接：

1. 國內鏡像源（下載速度較快）：
   https://hf-mirror.com/ggerganov/whisper.cpp/tree/main

2. Hugging Face 官方源：
   https://huggingface.co/ggerganov/whisper.cpp/tree/main

如果是蘋果芯片，需要同時下載模型對應的 encoder.mlmodelc 文件，並解壓出來放在模型相同目錄下。（如果是 q5 或者 q8 系列的模型，無須下載該文件）

下載完成後，您可以通過應用「引擎與模型」頁面中的「導入模型」功能將下載的模型文件導入到應用中。或者直接複製到模型目錄裡面即可。

導入步驟：

1. 在「引擎與模型」頁面中，點擊「導入模型」按鈕。
2. 在彈出的文件選擇器中，選擇您下載的模型文件。
3. 確認導入後，模型將被添加到您的已安裝模型列表中。

> FunASR / Qwen3-ASR / FireRedASR 等引擎的模型，可在「引擎與模型」頁面內按需下載（支持 ModelScope / GitHub 等多源）。

## 常見問題

##### 1. 提示應用程序已損壞，無法打開。

在終端中執行以下命令：

```shell
sudo xattr -dr com.apple.quarantine /Applications/SmartSub.app
```

然後再次運行應用程序。

## 貢獻

👏🏻 歡迎提交 Issue 和 Pull Request 來幫助改進這個項目！

## 支持

⭐ 如果您覺得這個項目對您有幫助，歡迎給我一個 star，或者請我喝一杯咖啡（請備註你的 github 賬號）。

👨‍👨‍👦‍👦 如果您有任何使用問題，歡迎加入微信交流群，一起交流學習。

| 支付寶收款碼                                   | 微信讚賞碼                                   | 微信交流群                                  |
| ---------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| ![支付寶收款碼](./resources/donate_alipay.jpg) | ![微信讚賞碼](./resources/donate_wechat.jpg) | ![微信交流群](./resources/WechatIMG428.png) |

## 許可證

本項目採用 MIT 許可證。詳情請見 [LICENSE](LICENSE) 文件。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=buxuku/SmartSub&type=Date)](https://star-history.com/#buxuku/SmartSub&Date)
