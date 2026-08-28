import Link from "next/link";

/**
 * The English terms of service. The zh-TW original is ./content-zh-tw.tsx and is the
 * source of truth: this is a faithful rendering of it, not a separate document. The
 * sections and their order must stay identical in both files — the section numbers
 * come from a CSS counter in LEGAL_CSS.
 *
 * Taiwanese legal references keep the Chinese in parentheses (the Personal Data
 * Protection Act, the company name, the court, the registered address) so a reviewer
 * can match them against the official record.
 */
export function TermsEn() {
  return (
    <>
      <div className="intro">
        <p>
          These terms are the agreement between you and{" "}
          <strong>Pathors Technology Co., Ltd.</strong>{" "}
          (派斯科技股份有限公司, unified business number 60410453, &ldquo;we&rdquo; or{" "}
          &ldquo;us&rdquo;) concerning Internal (
          <code>internal.pathors.com</code>, the &ldquo;Service&rdquo;).
        </p>
      </div>

      <section>
        <h2>What the Service is</h2>
        <p>
          The Service is a multi-tenant accounting and operations management system. It covers
          transaction records for the internal and external books, counterparties, invoices and
          reconciliation, projects, contracts, subscriptions and billing schedules, the employee
          roster and payroll, and optional Google Calendar sync.
        </p>
        <p>
          The Service also provides an MCP endpoint (<code>/mcp</code>) that lets you operate on
          your own data with AI clients such as ChatGPT and Claude once you have authorized them.
        </p>
        <p>
          The source code of the Service is published under the Apache 2.0 license.{" "}
          <strong>These terms govern the hosted service we operate</strong>
          (<code>internal.pathors.com</code>), not the source code license itself; an environment
          you set up yourself from the source code is not subject to these terms, and we are not
          responsible for it.
        </p>
      </section>

      <section>
        <h2>Accounts and workspaces</h2>
        <ul>
          <li>
            Signing up requires a Google account. The Service has no password login, so the
            security of your account depends on the security of your Google account.
          </li>
          <li>
            Whoever creates a workspace becomes its owner and can invite members, assign roles
            (owner / admin / member), remove members, revoke MCP authorizations, and delete the
            entire workspace.
          </li>
          <li>
            <strong>
              As regards the data inside a workspace, the individual or organization that created
              it is the data controller and we are the processor
            </strong>
            , processing the data on their instructions. See the{" "}
            <Link href="/privacy">Privacy Policy</Link> for details.
          </li>
          <li>
            You are responsible for everything that happens under your account, including what
            the members you invite and the AI clients you authorize do. If you discover
            unauthorized use, revoke the relevant authorization immediately and notify us.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your content</h2>
        <ul>
          <li>
            The data you enter or upload to the Service (&ldquo;your content&rdquo;) is{" "}
            <strong>owned by you or your organization</strong>; we acquire no ownership of it.
          </li>
          <li>
            You authorize us to process, store, transmit and back up your content to the extent
            necessary to provide the Service — and no further. We will not use it for marketing,
            and we will not use it to train any model.
          </li>
          <li>
            You warrant that you have the lawful right to enter this content. This applies in
            particular to employee personal data: you must already have given notice and have a
            lawful basis for collection under Taiwan&rsquo;s Personal Data Protection Act
            (個人資料保護法) before entering national ID numbers, payroll bank accounts and
            similar data into the Service.
          </li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>When using the Service, you must not:</p>
        <ul>
          <li>engage in unlawful conduct, or infringe the rights of others;</li>
          <li>
            upload malicious code, or attempt to bypass authentication, permissions or
            organization isolation in order to access data that is not yours;
          </li>
          <li>
            carry out penetration testing, stress testing or automated abuse against the system,
            unless you have obtained our written consent in advance;
          </li>
          <li>
            scrape data in bulk in an abnormal manner, degrading the quality of service for other
            users;
          </li>
          <li>
            resell the Service or repackage it as your own service for others, unless otherwise
            agreed in writing.
          </li>
        </ul>
        <p>
          Once you have authorized a third-party AI client with your data, how that client
          handles the content is at your own risk; our responsibility is limited to stopping its
          access immediately when you revoke the authorization.
        </p>
      </section>

      <section>
        <h2>Third-party services</h2>
        <p>
          The Service uses Google login and offers optional Google Calendar sync; you may also
          connect AI clients yourself. These services are provided by third parties and are
          subject to their own terms and privacy policies. We are not responsible for their
          availability, changes or behavior.
        </p>
      </section>

      <section>
        <h2>Fees</h2>
        <p>
          The fees for the Service are currently whatever we have agreed separately in writing
          with you (or your organization); where nothing has been agreed separately, you will not
          be charged.
        </p>
        <p>
          We reserve the right to change how we charge in the future. If we begin charging or
          change existing fees, we will give notice in advance by reasonable means and let you
          choose to stop using the Service before the effective date. We do not guarantee that
          the Service will be free forever.
        </p>
      </section>

      <section>
        <h2>Availability and changes to the Service</h2>
        <p>
          We will make reasonable efforts to keep the Service running, but{" "}
          <strong>we do not guarantee that it will be uninterrupted or error-free</strong>.
          Maintenance, supplier failures and force majeure can all cause interruptions.
        </p>
        <p>
          The Service is still under continuous development, and features may be added, changed
          or removed. For changes that materially affect how you use it, we will try to give
          notice in advance.
        </p>
      </section>

      <section>
        <h2>Termination</h2>
        <ul>
          <li>
            You may stop using the Service at any time and delete your workspace yourself. For
            what deletion <strong>actually does</strong>{" "}
            (which data remains in the database, whether files are removed), see the &ldquo;Retention and deletion&rdquo; section of
            the <Link href="/privacy">Privacy Policy</Link>.
          </li>
          <li>
            If you seriously breach these terms, use the Service for unlawful conduct, or where
            the law requires it, we may suspend or terminate your access; unless the situation is
            urgent or the law provides otherwise, we will notify you in advance and give you an
            opportunity to remedy.
          </li>
          <li>
            Data handling after termination likewise follows the Privacy Policy; you may write to
            us before or after termination to request an export or permanent deletion.
          </li>
        </ul>
      </section>

      <section>
        <h2>Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the
          extent permitted by law, we make no warranty, express or implied, as to fitness for a
          particular purpose, freedom from interruption, or freedom from error.
        </p>
        <p>
          <strong>
            The Service is a bookkeeping and accounting management tool and does not constitute
            accounting, tax, financial or legal advice.
          </strong>{" "}
          The reports, calculations and reminders the system produces are for reference only; you
          should check them yourself with your accountant, bookkeeper or tax agent. The
          responsibility for tax filings, for keeping books and supporting documents, and for
          their accuracy, rests with you.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental,
          special or consequential damages, including loss of business, loss of profit, loss of
          goodwill or loss of data.
        </p>
        <p>
          For all claims arising out of the Service, our cumulative liability is capped at the
          amount you actually paid us for the Service in the twelve (12) months before the claim
          arose; where you have never paid any fee, the cap is NT$10,000.
        </p>
        <p>
          The limitations in this section do not apply to damage caused by intent or gross
          negligence, or to situations where the law does not permit liability to be limited.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>
          When these terms change, we will update the &ldquo;last updated&rdquo; date at the top
          of this page; material changes will be notified in the system or by email. If you
          continue to use the Service after a change takes effect, you are treated as agreeing to
          the changed terms; if you do not agree, please stop using the Service.
        </p>
      </section>

      <section>
        <h2>Governing law and jurisdiction</h2>
        <p>
          The interpretation and application of these terms, and any dispute arising from them,
          are governed by <strong>the laws of the Republic of China (中華民國法律)</strong>, with
          the <strong>Taiwan Taipei District Court (臺灣臺北地方法院)</strong> as the court of
          first instance.
        </p>
      </section>

      <section>
        <h2>Contact us</h2>
        <p>
          Pathors Technology Co., Ltd. (派斯科技股份有限公司)
          <br />
          Unified business number: 60410453
          <br />
          Address: 6F., No. 95, Sec. 1, Chongqing S. Rd., Zhongzheng Dist., Taipei City, Taiwan
          (臺北市中正區重慶南路 1 段 95 號 6 樓)
          <br />
          Email: <a href="mailto:contact@pathors.com">contact@pathors.com</a>
        </p>
      </section>
    </>
  );
}
