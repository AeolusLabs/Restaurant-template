-- Account deletion (docs/ARCHITECTURE.md section 14) strips a deleted customer's phone and address from
-- their orders. Only the system role does that, never the app role.
GRANT UPDATE ON order_contacts TO system;
