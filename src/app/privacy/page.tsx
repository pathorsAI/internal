import type { Metadata } from "next";

import { LegalDoc } from "../legal-doc";

export const metadata: Metadata = {
  title: "隱私權政策 — Pathors Internal",
  description:
    "Pathors Internal 收集哪些資料、用途、受託處理者、第三方 AI 客戶端的存取與撤銷方式、保存期限與你的權利。",
};

/**
 * 公開的隱私權政策（免登入，見 src/middleware.ts 的 matcher），同時是 MCP
 * RFC 9728 metadata 的 `resource_policy_uri` 預設值（見 ../.well-known/metadata.ts）。
 *
 * 內容是照 code 實際行為寫的，不是樣板。改動系統行為時請一起改這裡，特別是：
 * 遮罩只發生在 MCP 輸出層（src/lib/pii.ts + tools-hr.ts 的 redactEmployee）、
 * 稽核紀錄沒有清理機制（src/db/activity.ts）、多數刪除是 soft delete 且 R2 檔案
 * 不會移除（src/db/mutations.ts）。
 */
export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="Privacy Policy"
      title="隱私權政策"
      lede="這份政策說明 Pathors Internal 收集哪些資料、為什麼收集、交給誰處理、保存多久，以及你可以要求我們做什麼。"
      otherDoc={{ href: "/terms", label: "服務條款" }}
    >
      <div className="intro">
        <p>
          <strong>派斯科技股份有限公司</strong>（Pathors Technology Co., Ltd.，統一編號
          60410453，以下稱「我們」）經營 Pathors Internal（<code>internal.pathors.com</code>，以下稱「本服務」）。
        </p>
        <p>
          本服務是一套多租戶的帳務系統：任何人都可以用 Google
          帳號註冊、建立自己的工作空間（workspace，系統內稱 organization），並邀請成員一起使用。
          你在工作空間裡輸入的資料只屬於該工作空間，與其他人的工作空間隔離。
        </p>
      </div>

      <section>
        <h2>我們的角色：控制者還是處理者</h2>
        <p>同一套系統裡有兩種資料，我們的角色不一樣，責任也不一樣：</p>
        <ul>
          <li>
            <strong>帳號資料</strong>（你的姓名、email、登入與 session
            紀錄）：我們是資料控制者，直接對你負責。
          </li>
          <li>
            <strong>你輸入的營運資料</strong>（交易、往來對象、專案、合約、員工、薪資、上傳的憑證）：
            建立該工作空間的個人或組織才是資料控制者，我們是依其指示保管與處理的受託處理者。
          </li>
        </ul>
        <p>
          員工個資屬於後者。如果你把員工的身分證字號或薪轉帳號輸入本服務，對該名員工負責的是你的組織
          —— 包含告知義務、蒐集依據，以及回應當事人的查詢與刪除要求。
        </p>
      </section>

      <section>
        <h2>我們收集哪些資料</h2>

        <h3>帳號與登入資料</h3>
        <ul>
          <li>
            Google 登入回傳的基本資料：姓名、email、email 是否已驗證、頭像網址。我們拿不到、也不儲存你的
            Google 密碼；本服務沒有自己的密碼登入。
          </li>
          <li>
            session 紀錄：session token、建立與到期時間、發起登入的 IP 位址與瀏覽器 User-Agent。
          </li>
          <li>組織成員關係與角色（owner／admin／member）。</li>
          <li>邀請紀錄：受邀者的 email、角色、狀態、到期時間、邀請人。</li>
          <li>
            若你另外連結 <strong>Google 日曆</strong>（可選功能，與登入分開授權）：我們會取得該次授權的
            access token 與 refresh token，存放在資料庫的帳號表中。授權範圍為 <code>openid</code>、<code>email</code>、<code>profile</code> 與 Google 日曆（<code>https://www.googleapis.com/auth/calendar</code>）。
          </li>
        </ul>

        <h3>你輸入的營運資料</h3>
        <ul>
          <li>
            <strong>帳務</strong>：交易的日期、金額、幣別、分類、摘要、報稅註記與統一編號；銀行帳戶的名稱、種類、幣別與期初餘額；發票；對帳紀錄。
          </li>
          <li>
            <strong>往來對象</strong>：客戶／供應商名稱、統一編號、聯絡資訊、備註。
          </li>
          <li>
            <strong>客戶營運</strong>：專案、合約、訂閱、請款項目與其排程。
          </li>
          <li>
            <strong>人事與薪資</strong>：員工姓名、身分證字號、聘僱類型、勞健保與勞退狀態與投保薪資、本薪、薪轉帳號、到職與離職日期、公司
            email、個人 email、電話、備註，以及薪資單與其明細。
          </li>
          <li>
            <strong>上傳的檔案</strong>：憑證、發票、報表等。檔案本身存放在 Cloudflare
            R2，資料庫存的是檔名、類型、大小與它對應到哪一筆交易或發票。
          </li>
        </ul>

        <h3>自動產生的紀錄</h3>
        <ul>
          <li>
            <strong>稽核紀錄</strong>：每一次建立、修改、刪除，以及每一次透過 MCP
            讀取員工資料，都會記下所屬組織、操作者的使用者 ID／email／姓名、來源通道（網頁或
            MCP）、動作類型、資料種類與 ID、一行摘要與時間。同組織的成員可以在系統中查看。
          </li>
          <li>
            平台層的請求日誌由 Cloudflare 依其自身政策產生與保存，我們不另外蒐集，也不把它與你的帳號串接。
          </li>
          <li>
            我們<strong>沒有</strong>安裝任何第三方分析、廣告或行為追蹤工具。
          </li>
        </ul>
      </section>

      <section>
        <h2>敏感欄位實際上怎麼被保護</h2>
        <p>這一節寫得比一般政策細，因為含糊其詞會讓人誤會保護程度：</p>
        <ul>
          <li>
            身分證字號與薪轉帳號<strong>以明文存在資料庫欄位裡</strong>，我們沒有做欄位層級的加密或雜湊。
            保護它們的是傳輸加密（HTTPS）、資料庫與物件儲存供應商提供的靜態加密，以及登入、組織隔離與角色權限。
          </li>
          <li>
            <strong>遮罩只發生在輸出的那一層，而且只針對 MCP</strong>：透過 MCP
            讀取員工資料時，身分證字號只保留前 3 碼、薪轉帳號只保留末 5 碼，其餘以<code>*</code> 取代。
          </li>
          <li>
            在網頁介面上，同組織中有權限的成員<strong>看得到完整值</strong>（勞健保申報與薪轉作業需要）。
          </li>
          <li>換句話說：遮罩不等於加密，資料庫裡儲存的值並沒有因此被改寫。</li>
        </ul>
      </section>

      <section>
        <h2>用途與法律依據</h2>
        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>目的</th>
                <th>處理的資料</th>
                <th>依據</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>提供與維運本服務</td>
                <td>帳號資料、營運資料</td>
                <td>履行與你（或你的組織）的契約</td>
              </tr>
              <tr>
                <td>身分驗證、組織隔離與權限控制</td>
                <td>帳號資料、成員關係、session</td>
                <td>履行契約</td>
              </tr>
              <tr>
                <td>稽核、異常追查與資訊安全</td>
                <td>稽核紀錄、session 的 IP 與 User-Agent</td>
                <td>正當利益（系統安全與內部控制）</td>
              </tr>
              <tr>
                <td>技術支援與除錯</td>
                <td>視問題而定，最小必要範圍</td>
                <td>正當利益</td>
              </tr>
              <tr>
                <td>帳簿憑證的保存與法遵</td>
                <td>營運資料、上傳的憑證</td>
                <td>你的組織依稅法等規定的法定義務，我們配合保存</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          處理員工個資或其他營運資料時，我們依你的組織的指示行事，不會拿它做其他用途，也不會用來訓練任何模型。
        </p>
      </section>

      <section>
        <h2>受託處理者（我們把資料交給誰）</h2>
        <p>只列實際用到的：</p>
        <ul>
          <li>
            <strong>Neon</strong> —— 代管 PostgreSQL 資料庫，存放上述所有結構化資料。
          </li>
          <li>
            <strong>Cloudflare</strong> —— Workers 執行環境與網站託管、R2 物件儲存（你上傳的檔案）。
          </li>
          <li>
            <strong>Google</strong> —— 帳號登入（OAuth）。若你啟用可選的日曆同步，我們還會把請款與收付款到期日的事件標題與說明（包含往來對象名稱與金額）寫進你授權的
            Google 日曆。
          </li>
        </ul>
        <p>
          除此之外沒有其他第三方。我們不販售個人資料，不做跨服務的行為廣告，也不為了行銷而分享資料。
          你自己接上的 AI 客戶端是另一回事，見下一節。
        </p>
      </section>

      <section>
        <h2>第三方 AI 客戶端（MCP）</h2>
        <p>
          本服務提供 MCP 端點（<code>/mcp</code>），讓 ChatGPT、Claude
          這類 AI 客戶端在你明確授權後代你操作資料。這段關係的細節如下：
        </p>
        <div className="panel">
          <h3>授權怎麼發生</h3>
          <p>
            走 OAuth 2.0。你會先在本服務登入（一樣是 Google
            登入），看到同意畫面，同意之後才發出 token。我們不會把任何密碼交給客戶端。
          </p>
          <h3>對方能存取哪些資料</h3>
          <p>
            token 綁定的是「你這個使用者」，因此它能碰到的範圍，就是你登入後能碰到的組織與資料：帳務交易、往來對象、分類與銀行帳戶、發票、專案、合約、訂閱、請款項目、員工資料、薪資（唯讀）、對帳紀錄與稽核紀錄。
            工具設計上會要求客戶端先列出你的組織並由你指定，不會自行猜測要操作哪一個組織。
          </p>
          <h3>遮罩仍然有效</h3>
          <p>
            員工的身分證字號與薪轉帳號在送出 MCP 之前一律遮罩（見上方「敏感欄位」一節），AI
            客戶端拿不到完整值。
          </p>
          <h3>每一次存取都留紀錄</h3>
          <p>
            所有經由 MCP 的寫入，以及員工資料的讀取，都會寫進稽核紀錄，通道標記為<code>mcp</code>，可在系統內查看。
          </p>
          <h3>token 存在哪裡</h3>
          <p>
            access token 與 refresh token 連同到期時間存放在我們資料庫的<code>oauth_access_token</code>；你同意過的客戶端與範圍記在<code>oauth_consent</code>；客戶端本身（名稱、類型、redirect URI）記在<code>oauth_application</code>。
          </p>
          <h3>怎麼撤銷</h3>
          <p>
            到系統的「設定 → MCP」頁面（<code>/dashboard/settings/mcp</code>）撤銷。該頁面只列出<strong>你自己授權過的</strong>客戶端，撤銷也只會刪除<strong>你自己的</strong> token 與同意紀錄，該客戶端立即失去代你存取的權限。
            由於同一個客戶端（例如 ChatGPT）可能被許多使用者各自授權，撤銷不會刪除客戶端本身的登錄資料，其他人的授權也不受影響。
            這個動作不需要組織管理員權限 —— 授權是你個人給出的，也由你自己收回。
          </p>
        </div>
        <p>
          <strong>請一併注意</strong>：你在 AI
          客戶端裡看到的內容，會依該客戶端與其模型供應商（例如 OpenAI、Anthropic）自己的條款與隱私政策被處理。
          那段關係不在我們的控制範圍內，授權之前請先讀過他們的政策。
        </p>
      </section>

      <section>
        <h2>保存期限與刪除（實際行為）</h2>
        <p>這一節同樣寫實情，請不要當成「按下刪除就永久消失」：</p>
        <ul>
          <li>
            <strong>多數刪除是軟刪除</strong>：交易、發票、往來對象、專案、合約、訂閱、請款項目、員工與憑證紀錄，按下刪除後會被標記刪除時間，從介面與 API
            消失，但那一列仍留在資料庫中。
          </li>
          <li>
            <strong>上傳到 R2 的檔案不會隨著憑證刪除而移除</strong>，物件會留在儲存桶裡。
          </li>
          <li>
            <strong>稽核紀錄沒有自動清理機制</strong>：它不會因為原始資料被刪除而消失，也沒有設定保存上限，會一直保留到有人手動清除為止。
          </li>
          <li>
            <strong>刪除組織</strong>：會移除組織本身與成員、邀請關係，你將無法再從介面存取該組織的資料；
            但該組織的帳務資料列目前仍留在資料庫中，不會被連帶清除。
          </li>
          <li>
            需要<strong>真正的永久刪除</strong>（含資料庫列與 R2 檔案），請寫信到{" "}<a href="mailto:contact@pathors.com">contact@pathors.com</a>{" "}
            提出，我們會人工處理並回覆完成情形。
          </li>
        </ul>
      </section>

      <section>
        <h2>你的權利</h2>
        <p>依個人資料保護法，你可以要求查詢或閱覽、製給複製本、補充或更正、停止蒐集處理利用，以及刪除你的個人資料。</p>
        <ul>
          <li>
            <strong>可以自己做的</strong>：在系統中查看與更正資料、刪除紀錄、管理成員、撤銷 MCP 授權、解除 Google 日曆連結。
          </li>
          <li>
            <strong>需要來信的</strong>：完整資料匯出、永久刪除、以及對處理方式提出異議。目前系統沒有一鍵匯出全部資料的功能，我們會以人工方式協助。
          </li>
        </ul>
        <p>
          如果你的資料是某個組織輸入的（例如你是被登錄在系統裡的員工），請先向該組織提出；我們作為受託處理者，會依其指示配合處理，也可以協助轉達。
        </p>
      </section>

      <section>
        <h2>Cookie 與瀏覽器儲存</h2>
        <ul>
          <li>
            <strong>session cookie</strong>：維持登入狀態所必要，沒有它無法使用系統。
          </li>
          <li>
            <strong>瀏覽器 localStorage</strong>：記住你最後使用的組織，以及語言與深淺色偏好。
          </li>
          <li>沒有廣告 cookie，也沒有第三方分析 cookie。</li>
        </ul>
      </section>

      <section>
        <h2>資料所在地</h2>
        <p>
          資料存放於我們的資料庫供應商（Neon）與雲端平台（Cloudflare）所提供的區域，服務本身透過 Cloudflare
          的全球網路提供，Google 登入與日曆則在 Google
          的基礎設施上處理。因此你的資料可能在台灣以外的地區被處理與儲存。所有連線一律經 HTTPS 加密。
        </p>
      </section>

      <section>
        <h2>安全措施</h2>
        <p>
          我們採取的措施包含：以 Google 帳號登入（本服務不保管密碼）、以組織為界的資料隔離、依角色區分的權限、伺服器端一律重新驗證權限而非信任前端、完整的稽核紀錄、MCP
          輸出的敏感欄位遮罩，以及對 MCP 端點的來源驗證。
          我們不宣稱系統絕對安全；若發生影響你資料的事故，我們會在查明後盡快通知受影響的組織。
        </p>
      </section>

      <section>
        <h2>未成年人</h2>
        <p>本服務是給企業與工作團隊使用的工具，不針對未滿 18 歲者提供，也不會主動向其蒐集個人資料。</p>
      </section>

      <section>
        <h2>本政策的更新</h2>
        <p>
          政策修改時，我們會更新本頁上方的「最後更新日期」。若變更會實質影響你的權利（例如新增受託處理者、改變保存方式），我們會在系統內或以
          email 另行通知。
        </p>
      </section>

      <section>
        <h2>聯絡我們</h2>
        <p>
          派斯科技股份有限公司（Pathors Technology Co., Ltd.）
          <br />
          統一編號：60410453
          <br />
          地址：臺北市中正區重慶南路 1 段 95 號 6 樓
          <br />
          電子郵件：<a href="mailto:contact@pathors.com">contact@pathors.com</a>
        </p>
      </section>
    </LegalDoc>
  );
}
