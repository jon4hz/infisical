import { Types } from 'mongoose';
import {
	IUser, 
	ISecret,
	IServiceAccount,
	User,
	Membership,
	IOrganization,
	Organization,
} from '../models';
import { sendMail } from './nodemailer';
import { validateMembership } from './membership';
import _ from 'lodash';
import { BadRequestError, UnauthorizedRequestError } from '../utils/errors';
import {
	validateMembershipOrg
} from '../helpers/membershipOrg';
import {
	PERMISSION_READ_SECRETS,
	PERMISSION_WRITE_SECRETS
} from '../variables';

/**
 * Initialize a user under email [email]
 * @param {Object} obj
 * @param {String} obj.email - email of user to initialize
 * @returns {Object} user - the initialized user
 */
const setupAccount = async ({ email }: { email: string }) => {
  const user = await new User({
    email
  }).save();

	return user;
};

/**
 * Finish setting up user
 * @param {Object} obj
 * @param {String} obj.userId - id of user to finish setting up
 * @param {String} obj.firstName - first name of user
 * @param {String} obj.lastName - last name of user
 * @param {Number} obj.encryptionVersion - version of auth encryption scheme used
 * @param {String} obj.protectedKey - protected key in encryption version 2
 * @param {String} obj.protectedKeyIV - IV of protected key in encryption version 2
 * @param {String} obj.protectedKeyTag - tag of protected key in encryption version 2
 * @param {String} obj.publicKey - publickey of user
 * @param {String} obj.encryptedPrivateKey - (encrypted) private key of user
 * @param {String} obj.encryptedPrivateKeyIV - iv for (encrypted) private key of user
 * @param {String} obj.encryptedPrivateKeyTag - tag for (encrypted) private key of user
 * @param {String} obj.salt - salt for auth SRP
 * @param {String} obj.verifier - verifier for auth SRP
 * @returns {Object} user - the completed user
 */
const completeAccount = async ({
	userId,
	firstName,
	lastName,
	encryptionVersion,
	protectedKey,
	protectedKeyIV,
	protectedKeyTag,
	publicKey,
	encryptedPrivateKey,
	encryptedPrivateKeyIV,
	encryptedPrivateKeyTag,
	salt,
	verifier
}: {
	userId: string;
	firstName: string;
	lastName: string;
	encryptionVersion: number;
	protectedKey: string;
	protectedKeyIV: string;
	protectedKeyTag: string;
	publicKey: string;
	encryptedPrivateKey: string;
	encryptedPrivateKeyIV: string;
	encryptedPrivateKeyTag: string;
	salt: string;
	verifier: string;
}) => {
  const options = {
    new: true
  };
  const user = await User.findByIdAndUpdate(
    userId,
    {
      firstName,
      lastName,
      encryptionVersion,
      protectedKey,
      protectedKeyIV,
      protectedKeyTag,
      publicKey,
      encryptedPrivateKey,
      iv: encryptedPrivateKeyIV,
      tag: encryptedPrivateKeyTag,
      salt,
      verifier
    },
    options
  );

	return user;
};

/**
 * Check if device with ip [ip] and user-agent [userAgent] has been seen for user [user].
 * If the device is unseen, then notify the user of the new device
 * @param {Object} obj
 * @param {String} obj.ip - login ip address
 * @param {String} obj.userAgent - login user-agent
 */
const checkUserDevice = async ({
	user,
	ip,
	userAgent
}: {
	user: IUser;
	ip: string;
	userAgent: string;
}) => {
	const isDeviceSeen = user.devices.some((device) => device.ip === ip && device.userAgent === userAgent);
		
	if (!isDeviceSeen) {
		// case: unseen login ip detected for user
		// -> notify user about the sign-in from new ip 
		
		user.devices = user.devices.concat([{
			ip: String(ip),
			userAgent
		}]);
		
		await user.save();

		// send MFA code [code] to [email]
		await sendMail({
			template: 'newDevice.handlebars',
			subjectLine: `Successful login from new device`,
			recipients: [user.email],
			substitutions: {
				email: user.email,
				timestamp: new Date().toString(),
				ip,
				userAgent
			}
		}); 
	}
}

/**
 * Validate that user (client) can access workspace
 * with id [workspaceId] and its environment [environment] with required permissions
 * [requiredPermissions]
 * @param {Object} obj
 * @param {User} obj.user - user client
 * @param {Types.ObjectId} obj.workspaceId - id of workspace to validate against
 * @param {String} environment - (optional) environment in workspace to validate against
 * @param {String[]} requiredPermissions - required permissions as part of the endpoint
 */
const validateUserClientForWorkspace = async ({
	user,
	workspaceId,
	environment,
	acceptedRoles,
	requiredPermissions
}: {
	user: IUser;
	workspaceId: Types.ObjectId;
	environment?: string;
	acceptedRoles: Array<'admin' | 'member'>;
	requiredPermissions?: string[];
}) => {
	
	// validate user membership in workspace
	const membership = await validateMembership({
        userId: user._id,
        workspaceId,
		acceptedRoles
    });
	
	let runningIsDisallowed = false;
	requiredPermissions?.forEach((requiredPermission: string) => {
		switch (requiredPermission) {
			case PERMISSION_READ_SECRETS:
				runningIsDisallowed = _.some(membership.deniedPermissions, { environmentSlug: environment, ability: PERMISSION_READ_SECRETS });
				break;
			case PERMISSION_WRITE_SECRETS:
				runningIsDisallowed = _.some(membership.deniedPermissions, { environmentSlug: environment, ability: PERMISSION_WRITE_SECRETS });
				break;
			default:
				break;
		}
		
		if (runningIsDisallowed) {
			throw UnauthorizedRequestError({
				message: `Failed permissions authorization for workspace environment action : ${requiredPermission}`
			});	
		}
	});
	
	return membership;
}

/**
 * Validate that user (client) can access secret [secret]
 * with required permissions [requiredPermissions]
 * @param {Object} obj
 * @param {User} obj.user - user client
 * @param {Secret[]} obj.secrets - secrets to validate against
 * @param {String[]} requiredPermissions - required permissions as part of the endpoint
 */
const validateUserClientForSecret = async ({
	user,
	secret,
	acceptedRoles,
	requiredPermissions
}: {
	user: IUser;
	secret: ISecret;
	acceptedRoles?: Array<'admin' | 'member'>;
	requiredPermissions?: string[];
}) => {
	const membership = await validateMembership({
		userId: user._id,
		workspaceId: secret.workspace,
		acceptedRoles
	});
	
	if (requiredPermissions?.includes(PERMISSION_WRITE_SECRETS)) {
		const isDisallowed = _.some(membership.deniedPermissions, { environmentSlug: secret.environment, ability: PERMISSION_WRITE_SECRETS });

		if (isDisallowed) {
			throw UnauthorizedRequestError({
				message: 'You do not have the required permissions to perform this action' 
			});
		}
	}
}

/**
 * Validate that user (client) can access secrets [secrets]
 * with required permissions [requiredPermissions]
 * @param {Object} obj
 * @param {User} obj.user - user client
 * @param {Secret[]} obj.secrets - secrets to validate against
 * @param {String[]} requiredPermissions - required permissions as part of the endpoint
 */
 const validateUserClientForSecrets = async ({
	user,
	secrets,
	requiredPermissions
}: {
	user: IUser;
	secrets: ISecret[];
	requiredPermissions?: string[];
}) => {
	
	// TODO: add acceptedRoles?

	const userMemberships = await Membership.find({ user: user._id })
	const userMembershipById = _.keyBy(userMemberships, 'workspace');
	const workspaceIdsSet = new Set(userMemberships.map((m) => m.workspace.toString()));

	// for each secret check if the secret belongs to a workspace the user is a member of
	secrets.forEach((secret: ISecret) => {
		if (!workspaceIdsSet.has(secret.workspace.toString())) {
			throw BadRequestError({
				message: 'Failed authorization for the secret'
			});
		}

		if (requiredPermissions?.includes(PERMISSION_WRITE_SECRETS)) {
			const deniedMembershipPermissions = userMembershipById[secret.workspace.toString()].deniedPermissions;
			const isDisallowed = _.some(deniedMembershipPermissions, { environmentSlug: secret.environment, ability: PERMISSION_WRITE_SECRETS });

			if (isDisallowed) {
				throw UnauthorizedRequestError({
					message: 'You do not have the required permissions to perform this action' 
				});
			}
		}
	});
}

/**
 * Validate that user (client) can access service account [serviceAccount]
 * with required permissions [requiredPermissions]
 * @param {Object} obj
 * @param {User} obj.user - user client
 * @param {ServiceAccount} obj.serviceAccount - service account to validate against
 * @param {String[]} requiredPermissions - required permissions as part of the endpoint
 */
const validateUserClientForServiceAccount = async ({
	user,
	serviceAccount,
	requiredPermissions
}: {
	user: IUser;
	serviceAccount: IServiceAccount;
	requiredPermissions?: string[];
}) => {
	if (!serviceAccount.user.equals(user._id)) {
		// case: user who created service account is not the
		// same user that is on the request
		await validateMembershipOrg({
			userId: user._id,
			organizationId: serviceAccount.organization,
			acceptedRoles: [],
			acceptedStatuses: []
		});
	}
}

/**
 * Validate that user (client) can access organization [organization]
 * @param {Object} obj
 * @param {User} obj.user - user client
 * @param {Organization} obj.organization - organization to validate against
 */
 const validateUserClientForOrganization = async ({
	user,
	organization,
	acceptedRoles,
	acceptedStatuses
}: {
	user: IUser;
	organization: IOrganization;
	acceptedRoles: Array<'owner' | 'admin' | 'member'>;
	acceptedStatuses: Array<'invited' | 'accepted'>;
}) => {
	const membershipOrg = await validateMembershipOrg({
		userId: user._id,
		organizationId: organization._id,
		acceptedRoles,
		acceptedStatuses
	});
	
	return membershipOrg;
}

export { 
	setupAccount, 
	completeAccount, 
	checkUserDevice,
	validateUserClientForWorkspace,
	validateUserClientForSecrets,
	validateUserClientForServiceAccount,
	validateUserClientForOrganization,
	validateUserClientForSecret
};
