import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const BOUNCE_FROM = process.env.BOUNCE_FROM_ADDRESS ?? "noreply@shadow.yourdomain.com";

export async function sendBounce(recipientAddress: string, originalFrom: string): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      Source: BOUNCE_FROM,
      Destination: { ToAddresses: [originalFrom] },
      Message: {
        Subject: { Data: "Delivery failed: address not found or disabled" },
        Body: {
          Text: {
            Data: `The email address ${recipientAddress} is not active or does not exist. Please contact the sender for an updated address.`,
          },
        },
      },
    })
  );
}
