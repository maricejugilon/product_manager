import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, CopyCheck, FileSpreadsheet, Layers3, LogOut, PackageSearch, Tags, Trash2 } from "lucide-react";

import "./globals.css";

export const metadata: Metadata = {
  title: "FCW Product Manager",
  description: "Review-first WooCommerce product manager"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brand-mark">FCW</span>
            <span>Product Manager</span>
          </Link>
          <nav className="nav">
            <Link href="/">
              <PackageSearch size={17} />
              Products
            </Link>
            <Link href="/categories">
              <Layers3 size={17} />
              Categories
            </Link>
            <Link href="/categories-cleanup">
              <Trash2 size={17} />
              Categories Cleanup
            </Link>
            <Link href="/duplicates">
              <CopyCheck size={17} />
              Duplicates
            </Link>
            <Link href="/product-sheet-validator">
              <FileSpreadsheet size={17} />
              Sheet Validator
            </Link>
            <Link href="/make-and-model">
              <Tags size={17} />
              Make and Model
            </Link>
            <Link href="/reviews">
              <ClipboardCheck size={17} />
              Review Queue
            </Link>
            {process.env.APP_ADMIN_PASSWORD ? (
              <a href="/api/logout">
                <LogOut size={17} />
                Logout
              </a>
            ) : null}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
