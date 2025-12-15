import sqlite3

conn = sqlite3.connect("instance/trickia.db")
cur = conn.cursor()

print("TABLES :")
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
for row in cur.fetchall():
    print("-", row[0])

print("\nUSER_THEME_STATS :")
cur.execute("SELECT * FROM user_theme_stats")
rows = cur.fetchall()

if not rows:
    print("⚠️  Table vide")
else:
    for r in rows:
        print(r)

conn.close()