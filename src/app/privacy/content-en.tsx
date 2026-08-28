/**
 * The English privacy policy. The zh-TW original is ./content-zh-tw.tsx and is the
 * source of truth: this is a faithful rendering of it, not a separate document.
 * The sections and their order must stay identical in both files — the section
 * numbers come from a CSS counter in LEGAL_CSS, so reordering one side breaks the
 * cross-references in the other.
 *
 * Taiwanese legal terms keep the Chinese in parentheses on first use
 * (Personal Data Protection Act, the company name, the registered address) so a
 * reviewer can match them against the official record.
 */
export function PrivacyEn() {
  return (
    <>
      <div className="intro">
        <p>
          <strong>Pathors Technology Co., Ltd.</strong>{" "}
          (派斯科技股份有限公司, unified business number 60410453, &ldquo;we&rdquo; or{" "}
          &ldquo;us&rdquo;) operates Internal (
          <code>internal.pathors.com</code>, the &ldquo;Service&rdquo;).
        </p>
        <p>
          The Service is a multi-tenant accounting system: anyone can sign up with a Google
          account, create their own workspace (called an organization inside the system), and
          invite members to use it together. The data you enter in a workspace belongs to that
          workspace alone and is isolated from other people&rsquo;s workspaces.
        </p>
      </div>

      <section>
        <h2>Our role: controller or processor</h2>
        <p>
          There are two kinds of data in the same system. Our role differs between them, and so
          does our responsibility:
        </p>
        <ul>
          <li>
            <strong>Account data</strong> (your name, email, login and session records): we are
            the data controller and are directly responsible to you.
          </li>
          <li>
            <strong>The operational data you enter</strong> (transactions, counterparties,
            projects, contracts, employees, payroll, uploaded supporting documents): the
            individual or organization that created the workspace is the data controller; we are
            the processor entrusted to hold and process it on their instructions.
          </li>
        </ul>
        <p>
          Employee personal data falls into the latter category. If you enter an employee&rsquo;s
          national ID number or payroll bank account into the Service, it is your organization
          that is responsible to that employee — including the duty to notify, the basis for
          collection, and responding to that person&rsquo;s requests for access and deletion.
        </p>
      </section>

      <section>
        <h2>What data we collect</h2>

        <h3>Account and login data</h3>
        <ul>
          <li>
            The basic profile Google returns at login: name, email, whether the email is
            verified, and avatar URL. We never receive or store your Google password; the
            Service has no password login of its own.
          </li>
          <li>
            Session records: session token, creation and expiry times, and the IP address and
            browser User-Agent that started the login.
          </li>
          <li>Organization membership and role (owner / admin / member).</li>
          <li>
            Invitation records: the invitee&rsquo;s email, role, status, expiry time, and who
            sent the invitation.
          </li>
          <li>
            If you additionally connect <strong>Google Calendar</strong> (an optional feature,
            authorized separately from login): we receive the access token and refresh token
            from that authorization and store them in the account table of our database. The
            scopes are <code>openid</code>, <code>email</code>, <code>profile</code> and Google
            Calendar (<code>https://www.googleapis.com/auth/calendar</code>).
          </li>
        </ul>

        <h3>The operational data you enter</h3>
        <ul>
          <li>
            <strong>Accounting</strong>: the date, amount, currency, category, description, tax
            filing flag and unified business number of transactions; the name, type, currency and
            opening balance of bank accounts; invoices; reconciliation records.
          </li>
          <li>
            <strong>Counterparties</strong>: customer / supplier name, unified business number,
            contact details, notes.
          </li>
          <li>
            <strong>Customer operations</strong>: projects, contracts, subscriptions, billing
            items and their schedules.
          </li>
          <li>
            <strong>HR and payroll</strong>: employee name, national ID number, employment type,
            labor and health insurance and labor pension status and insured salary, base salary,
            payroll bank account, start and end dates, company email, personal email, phone
            number, notes, and payslips with their line items.
          </li>
          <li>
            <strong>Uploaded files</strong>: supporting documents, invoices, reports and the
            like. The files themselves are stored in Cloudflare R2; the database stores the file
            name, type and size, and which transaction or invoice it belongs to.
          </li>
        </ul>

        <h3>Records generated automatically</h3>
        <ul>
          <li>
            <strong>Audit records</strong>: every creation, modification and deletion, and every
            read of employee data through MCP, records the organization it belongs to, the
            operator&rsquo;s user ID / email / name, the channel it came through (web or MCP),
            the type of action, the kind of data and its ID, a one-line summary, and the time.
            Members of the same organization can view them in the system.
          </li>
          <li>
            Request logs at the platform layer are generated and retained by Cloudflare under its
            own policy. We do not collect them separately and do not link them to your account.
          </li>
          <li>
            We have <strong>not</strong> installed any third-party analytics, advertising or
            behavioral tracking tools.
          </li>
        </ul>
      </section>

      <section>
        <h2>How sensitive fields are actually protected</h2>
        <p>
          This section is more specific than a policy usually is, because vague wording would
          leave a wrong impression of how much protection there is:
        </p>
        <ul>
          <li>
            National ID numbers and payroll bank accounts are{" "}
            <strong>stored as plain text in database columns</strong>; we do not apply
            field-level encryption or hashing. What protects them is transport encryption
            (HTTPS), the encryption at rest provided by our database and object storage
            providers, and login, organization isolation and role-based permissions.
          </li>
          <li>
            <strong>Masking happens only at the output layer, and only for MCP</strong>: when
            employee data is read through MCP, only the first 3 characters of the national ID
            number and the last 5 characters of the payroll bank account are kept, and the rest
            are replaced with <code>*</code>.
          </li>
          <li>
            In the web interface, members of the same organization who have the permission{" "}
            <strong>see the full values</strong> (filing labor and health insurance and running
            payroll transfers require them).
          </li>
          <li>
            In other words: masking is not encryption, and the values stored in the database are
            not rewritten by it.
          </li>
        </ul>
      </section>

      <section>
        <h2>Purposes and legal bases</h2>
        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Data processed</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Providing and operating the Service</td>
                <td>Account data, operational data</td>
                <td>Performance of the contract with you (or your organization)</td>
              </tr>
              <tr>
                <td>Authentication, organization isolation and permission control</td>
                <td>Account data, membership, sessions</td>
                <td>Performance of the contract</td>
              </tr>
              <tr>
                <td>Auditing, investigating anomalies, and information security</td>
                <td>Audit records, session IP and User-Agent</td>
                <td>Legitimate interests (system security and internal control)</td>
              </tr>
              <tr>
                <td>Technical support and debugging</td>
                <td>Depends on the issue; the minimum necessary</td>
                <td>Legitimate interests</td>
              </tr>
              <tr>
                <td>Retention of books and supporting documents, and legal compliance</td>
                <td>Operational data, uploaded supporting documents</td>
                <td>
                  Your organization&rsquo;s statutory obligations under tax and other laws; we
                  retain the data in support of them
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          When processing employee personal data or other operational data, we act on your
          organization&rsquo;s instructions. We will not use it for any other purpose, and we
          will not use it to train any model.
        </p>
      </section>

      <section>
        <h2>Processors (who we hand data to)</h2>
        <p>Only the ones actually in use are listed:</p>
        <ul>
          <li>
            <strong>Neon</strong> — managed PostgreSQL database, holding all of the structured
            data described above.
          </li>
          <li>
            <strong>Cloudflare</strong> — the Workers runtime and site hosting, and R2 object
            storage (the files you upload).
          </li>
          <li>
            <strong>Google</strong> — account login (OAuth). If you enable the optional calendar
            sync, we also write the titles and descriptions of billing and payment due-date
            events (including counterparty names and amounts) into the Google Calendar you
            authorized.
          </li>
        </ul>
        <p>
          There are no other third parties. We do not sell personal data, we do not run
          cross-service behavioral advertising, and we do not share data for marketing. The AI
          clients you connect yourself are a separate matter — see the next section.
        </p>
      </section>

      <section>
        <h2>Third-party AI clients (MCP)</h2>
        <p>
          The Service provides an MCP endpoint (<code>/mcp</code>) that lets AI clients such as
          ChatGPT and Claude operate on your data on your behalf once you have explicitly
          authorized them. The details of that relationship are as follows:
        </p>
        <div className="panel">
          <h3>How authorization happens</h3>
          <p>
            It goes through OAuth 2.0. You first log in to the Service (again with Google login)
            and see a consent screen; a token is issued only after you consent. We do not hand
            any password to the client.
          </p>
          <h3>What data the client can reach</h3>
          <p>
            The token is bound to you as a user, so what it can reach is exactly the
            organizations and data you can reach once logged in: accounting transactions,
            counterparties, categories and bank accounts, invoices, projects, contracts,
            subscriptions, billing items, employee data, payroll (read-only), reconciliation
            records and audit records. The tools are designed to make the client list your
            organizations and have you name one, rather than guessing which organization to
            operate on.
          </p>
          <h3>Masking still applies</h3>
          <p>
            Employees&rsquo; national ID numbers and payroll bank accounts are always masked
            before being sent out over MCP (see the section on sensitive fields above); AI
            clients do not receive the full values.
          </p>
          <h3>Every access is recorded</h3>
          <p>
            Every write through MCP, and every read of employee data, is written to the audit
            records with the channel marked as <code>mcp</code>, viewable inside the system.
          </p>
          <h3>Where tokens are stored</h3>
          <p>
            Access tokens and refresh tokens, together with their expiry times, are stored in our
            database in <code>oauth_access_token</code>; the clients and scopes you have
            consented to are recorded in <code>oauth_consent</code>; the clients themselves
            (name, type, redirect URI) are recorded in <code>oauth_application</code>.
          </p>
          <h3>How to revoke</h3>
          <p>
            Revoke it on the system&rsquo;s Settings → MCP page
            (<code>/dashboard/settings/mcp</code>). That page lists only the clients{" "}
            <strong>you yourself have authorized</strong>, and revoking deletes only{" "}
            <strong>your own</strong>{" "}
            tokens and consent records; the client immediately loses
            its permission to act on your behalf. Because the same client (ChatGPT, for example)
            may have been authorized separately by many users, revoking does not delete the
            client&rsquo;s own registration, and other people&rsquo;s authorizations are
            unaffected. This action does not require organization administrator permission — the
            authorization was given by you personally, and it is withdrawn by you.
          </p>
        </div>
        <p>
          <strong>Please also note</strong>: what you see inside an AI client is handled under
          the terms and privacy policy of that client and its model provider (OpenAI or
          Anthropic, for example). That relationship is outside our control; please read their
          policies before authorizing.
        </p>
      </section>

      <section>
        <h2>Retention and deletion (what actually happens)</h2>
        <p>
          This section likewise describes the real behavior. Please do not read it as &ldquo;press
          delete and it is gone forever&rdquo;:
        </p>
        <ul>
          <li>
            <strong>Most deletions are soft deletions</strong>: transactions, invoices,
            counterparties, projects, contracts, subscriptions, billing items, employees and
            supporting-document records are marked with a deletion time when you press delete and
            disappear from the interface and the API, but that row remains in the database.
          </li>
          <li>
            <strong>
              Files uploaded to R2 are not removed when the supporting-document record is deleted
            </strong>; the object stays in the bucket.
          </li>
          <li>
            <strong>There is no automatic cleanup of audit records</strong>: they do not
            disappear because the original data was deleted, no retention limit is configured,
            and they are kept until someone clears them manually.
          </li>
          <li>
            <strong>Deleting an organization</strong>{" "}
            removes the organization itself along with
            its memberships and invitations, and you will no longer be able to reach that
            organization&rsquo;s data through the interface; but that organization&rsquo;s
            accounting data rows currently remain in the database and are not cleared along with
            it.
          </li>
          <li>
            If you need <strong>genuine permanent deletion</strong> (including database rows and
            R2 files), write to{" "}<a href="mailto:contact@pathors.com">contact@pathors.com</a>{" "}
            and we will handle it manually and reply with what was done.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          Under Taiwan&rsquo;s Personal Data Protection Act (個人資料保護法), you may request to
          inquire about or review your personal data, to be given a copy of it, to supplement or
          correct it, to stop its collection, processing and use, and to delete it.
        </p>
        <ul>
          <li>
            <strong>What you can do yourself</strong>: view and correct data in the system,
            delete records, manage members, revoke MCP authorizations, and disconnect Google
            Calendar.
          </li>
          <li>
            <strong>What requires an email to us</strong>: a full data export, permanent
            deletion, and objections to how data is processed. The system currently has no
            one-click export of all data; we will help with it manually.
          </li>
        </ul>
        <p>
          If your data was entered by an organization (for example, if you are an employee
          recorded in the system), please raise it with that organization first; as a processor,
          we will act on their instructions and can also help pass the request along.
        </p>
      </section>

      <section>
        <h2>Cookies and browser storage</h2>
        <ul>
          <li>
            <strong>Session cookie</strong>: necessary to keep you logged in; the system cannot be
            used without it.
          </li>
          <li>
            <strong>Browser localStorage</strong>: remembers the organization you last used, along
            with your language and light / dark preferences.
          </li>
          <li>There are no advertising cookies and no third-party analytics cookies.</li>
        </ul>
      </section>

      <section>
        <h2>Where data is located</h2>
        <p>
          Data is stored in the regions provided by our database provider (Neon) and cloud
          platform (Cloudflare); the Service itself is delivered over Cloudflare&rsquo;s global
          network, and Google login and calendar are handled on Google&rsquo;s infrastructure.
          Your data may therefore be processed and stored outside Taiwan. All connections are
          encrypted with HTTPS.
        </p>
      </section>

      <section>
        <h2>Security measures</h2>
        <p>
          The measures we take include: login with a Google account (the Service holds no
          passwords), data isolation along organization boundaries, role-based permissions,
          always re-verifying permissions on the server rather than trusting the front end,
          complete audit records, masking of sensitive fields in MCP output, and origin
          validation on the MCP endpoint. We do not claim the system is absolutely secure; if an
          incident affects your data, we will notify the affected organizations as soon as
          possible after establishing the facts.
        </p>
      </section>

      <section>
        <h2>Minors</h2>
        <p>
          The Service is a tool for businesses and working teams. It is not offered to people
          under 18, and we do not actively collect personal data from them.
        </p>
      </section>

      <section>
        <h2>Updates to this policy</h2>
        <p>
          When this policy changes, we will update the &ldquo;last updated&rdquo; date at the top
          of this page. If a change materially affects your rights (adding a processor, or
          changing how data is retained, for example), we will give separate notice in the system
          or by email.
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
