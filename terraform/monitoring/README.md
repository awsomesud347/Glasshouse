# On-Demand Monitoring

Ephemeral Prometheus + Grafana on a dedicated EC2 instance, decoupled from the
app instance. Spin up when you need to monitor (load tests, demos, screenshots),
tear down after. Costs pennies per session instead of a second always-on box.

## Why separate

The observability stack is memory-hungry and, when co-located on the app's
t3.micro, competed for resources under load (and fell over during a load test).
Running it on its own instance keeps the app instance dedicated to serving the
app. Prometheus scrapes the app's /metrics over the private VPC network.

## Spin up

    cd terraform/monitoring
    cp terraform.tfvars.example terraform.tfvars   # edit your_ip
    terraform init
    terraform apply

Note the outputs: `monitoring_public_ip` (SSH/tunnel target) and
`scrape_target_hint` (the app's private IP:443 to scrape).

Then SSH to the monitoring instance and bring up the stack, pointing Prometheus
at the app's private IP:

    ssh -i vault-key.pem ec2-user@<monitoring_public_ip>
    cd Glasshouse
    API_METRICS_TARGET="<app_private_ip>:443" \
      docker compose -f docker-compose.observability.yml up -d

View Grafana via an SSH tunnel from your machine:

    ssh -i vault-key.pem -L 3000:localhost:3000 ec2-user@<monitoring_public_ip>
    # then open http://localhost:3000

## Tear down

    terraform destroy

This removes the monitoring instance, its security group, AND the ingress rule
it added to the app SG — returning the app SG to its clean state. The app
infrastructure is never touched.

## Notes

- Prometheus scrapes the app's nginx on 443 with TLS verification disabled
  (the origin cert is for the public hostname, not the private IP; the scrape
  is over the trusted private VPC network).
- nginx on the app instance must allow /metrics from the monitoring instance's
  private IP (see the app nginx config's /metrics location block).
- The monitoring instance gets a fresh public IP each spin-up — that's fine,
  it's ephemeral and reached via tunnel.