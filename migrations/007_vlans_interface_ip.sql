-- 007: Add interface_ip column to vlans table
-- Stores the host IP assigned to the monitoring interface (e.g. 192.168.1.50)

ALTER TABLE vlans ADD COLUMN interface_ip INET;

-- Seed existing VLAN 4 sandbox with the enroller's static IP
UPDATE vlans SET interface_ip = '192.168.1.50' WHERE vlan_id = 4;
